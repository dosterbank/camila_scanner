-- Enables price tracking for individual descargos and includes them in sales statistics.
-- Unlinked descargos without a saved price (including historical ones) are not backfilled.

create table if not exists public.movimientos_ventas (
  movimiento_fecha timestamptz not null,
  movimiento_usuario text not null,
  movimiento_nombre text not null,
  movimiento_cantidad integer not null check (movimiento_cantidad < 0),
  codigo text not null,
  precio_tipo text not null check (precio_tipo in ('precio_normal', 'precio_en_vivo', 'precio_mayorista')),
  precio numeric(12, 2) check (precio is null or precio >= 0),
  primary key (movimiento_fecha, movimiento_usuario, movimiento_nombre, movimiento_cantidad)
);
alter table public.movimientos_ventas enable row level security;
revoke all on public.movimientos_ventas from public, anon, authenticated;

create or replace function public.comprobar_limite_rpc(p_operacion text, p_maximo integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_solicitudes integer;
begin
  if v_usuario is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_operacion not in (
      'buscar_cliente', 'guardar_pedido', 'estadisticas_ventas', 'productos_mas_vendidos',
      'ventas_caja_dia', 'comprobantes_dia', 'resumen_caja_dia', 'historial_cierres_caja',
      'descargos_caja_dia', 'detalle_pedido', 'cerrar_caja', 'registrar_precio_descargo'
    )
    or p_maximo < 1 or p_maximo > 100 then
    raise exception 'Operacion no permitida.';
  end if;

  insert into public.rpc_rate_limits as limites
    (user_id, operation, window_started_at, request_count)
  values (v_usuario, p_operacion, now(), 1)
  on conflict (user_id, operation) do update set
    window_started_at = case
      when limites.window_started_at <= now() - interval '1 minute' then now()
      else limites.window_started_at
    end,
    request_count = case
      when limites.window_started_at <= now() - interval '1 minute' then 1
      else limites.request_count + 1
    end
  returning request_count into v_solicitudes;

  return v_solicitudes <= p_maximo;
end;
$$;
revoke all on function public.comprobar_limite_rpc(text, integer) from public, anon, authenticated;

create or replace function public.registrar_precio_descargo(
  p_fecha timestamptz, p_nombre text, p_cantidad integer, p_codigo text, p_precio_tipo text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_usuario text := coalesce(nullif(auth.jwt() ->> 'email', ''), auth.uid()::text);
  v_fecha timestamptz;
  v_nombre text;
  v_cantidad integer;
  v_movimiento_usuario text;
  v_precio numeric;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_fecha is null or p_nombre is null or length(btrim(p_nombre)) not between 1 and 200
    or p_cantidad is null or p_cantidad not between 1 and 999999
    or p_codigo is null or length(p_codigo) > 100
    or p_precio_tipo is null
      or p_precio_tipo not in ('precio_normal', 'precio_en_vivo', 'precio_mayorista') then
    raise exception 'Los datos del precio de descargo no son validos.';
  end if;
  if not public.comprobar_limite_rpc('registrar_precio_descargo', 100) then
    raise exception 'Demasiadas actualizaciones de precio. Espera un minuto e intenta de nuevo.';
  end if;
  select case p_precio_tipo
      when 'precio_normal' then p.precio_normal
      when 'precio_en_vivo' then p.precio_en_vivo
      when 'precio_mayorista' then p.precio_mayorista
    end
  into v_precio
  from public.productos p
  where p.codigo::text = p_codigo and lower(btrim(p.nombre)) = lower(btrim(p_nombre));
  if not found then
    raise exception 'No se encontro el producto del descargo para guardar su precio.';
  end if;

  select m.created_at, m.nombre, m.cantidad, m.usuario
  into v_fecha, v_nombre, v_cantidad, v_movimiento_usuario
  from public.movimientos m
  where m.created_at between p_fecha - interval '2 minutes' and p_fecha + interval '2 minutes'
    and lower(btrim(m.usuario)) = lower(btrim(v_usuario))
    and lower(btrim(m.nombre)) = lower(btrim(p_nombre))
    and m.cantidad = -p_cantidad
    and not exists (
      select 1 from public.movimientos_comprobantes mc
      where mc.movimiento_fecha = m.created_at
        and mc.movimiento_usuario = m.usuario
        and mc.movimiento_nombre = m.nombre
        and mc.movimiento_cantidad = m.cantidad
    )
  order by abs(extract(epoch from (m.created_at - p_fecha))), m.created_at desc
  limit 1
  for update of m;
  if not found then
    raise exception 'No se encontro el descargo reciente. El movimiento de inventario se registro, pero no se pudo asociar su precio.';
  end if;

  insert into public.movimientos_ventas (
    movimiento_fecha, movimiento_usuario, movimiento_nombre, movimiento_cantidad,
    codigo, precio_tipo, precio
  )
  values (v_fecha, v_movimiento_usuario, v_nombre, v_cantidad, p_codigo, p_precio_tipo, v_precio)
  on conflict (movimiento_fecha, movimiento_usuario, movimiento_nombre, movimiento_cantidad)
  do update set codigo = excluded.codigo, precio_tipo = excluded.precio_tipo, precio = excluded.precio;
end;
$$;
revoke all on function public.registrar_precio_descargo(timestamptz, text, integer, text, text) from public, anon;
grant execute on function public.registrar_precio_descargo(timestamptz, text, integer, text, text) to authenticated;

create or replace function public.estadisticas_ventas(p_periodo text, p_fecha date, p_zona text)
returns table (periodo date, total numeric, pedidos bigint)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_unidad text;
  v_paso interval;
  v_ultimo date;
  v_inicio date;
  v_fin date;
begin
  if auth.uid() is null or not public.usuario_es_admin() then
    raise exception 'Solo administradores pueden consultar estadisticas.';
  end if;
  if p_fecha is null or p_periodo is null or p_periodo not in ('dia', 'semana', 'mes')
    or p_zona is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zona) then
    raise exception 'Periodo, fecha o zona horaria no validos.';
  end if;
  if not public.comprobar_limite_rpc('estadisticas_ventas', 30) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;

  case p_periodo
    when 'dia' then
      v_unidad := 'day'; v_paso := interval '1 day'; v_ultimo := p_fecha; v_inicio := p_fecha;
    when 'semana' then
      v_unidad := 'day'; v_paso := interval '1 day';
      v_ultimo := p_fecha; v_inicio := p_fecha - 6;
    when 'mes' then
      v_unidad := 'day'; v_paso := interval '1 day';
      v_inicio := date_trunc('month', p_fecha::timestamp)::date;
      v_ultimo := (v_inicio + interval '1 month' - interval '1 day')::date;
  end case;
  v_fin := (v_ultimo::timestamp + v_paso)::date;

  return query
  with buckets as (
    select serie.valor::date as dia
    from generate_series(v_inicio::timestamp, v_ultimo::timestamp, v_paso) as serie(valor)
  ), ventas_detalle as (
    select date_trunc(v_unidad, p.fecha at time zone p_zona)::date as dia,
      p.total::numeric as importe, 1::bigint as cantidad
    from public.pedidos p
    where p.fecha >= (v_inicio::timestamp at time zone p_zona)
      and p.fecha < (v_fin::timestamp at time zone p_zona)
      and p.tipo = 'venta'
    union all
    select date_trunc(v_unidad, m.created_at at time zone p_zona)::date,
      (mv.precio * abs(m.cantidad))::numeric, 1::bigint
    from public.movimientos m
    join public.movimientos_ventas mv
      on mv.movimiento_fecha = m.created_at
      and mv.movimiento_usuario = m.usuario
      and mv.movimiento_nombre = m.nombre
      and mv.movimiento_cantidad = m.cantidad
    where m.created_at >= (v_inicio::timestamp at time zone p_zona)
      and m.created_at < (v_fin::timestamp at time zone p_zona)
      and m.cantidad < 0
      and not exists (
        select 1 from public.movimientos_comprobantes mc
        where mc.movimiento_fecha = m.created_at
          and mc.movimiento_usuario = m.usuario
          and mc.movimiento_nombre = m.nombre
          and mc.movimiento_cantidad = m.cantidad
      )
  ), ventas as (
    select d.dia, sum(d.importe)::numeric as importe, sum(d.cantidad)::bigint as cantidad
    from ventas_detalle d
    group by d.dia
  )
  select b.dia, coalesce(v.importe, 0), coalesce(v.cantidad, 0)
  from buckets b left join ventas v on v.dia = b.dia
  order by b.dia;
end;
$$;

create or replace function public.productos_mas_vendidos(p_periodo text, p_fecha date, p_zona text)
returns table (codigo text, producto text, unidades bigint)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inicio date;
  v_fin date;
begin
  if auth.uid() is null or not public.usuario_es_admin() then
    raise exception 'Solo administradores pueden consultar estadisticas.';
  end if;
  if p_fecha is null or p_periodo is null or p_periodo not in ('dia', 'semana', 'mes')
    or p_zona is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zona) then
    raise exception 'Periodo, fecha o zona horaria no validos.';
  end if;
  if not public.comprobar_limite_rpc('productos_mas_vendidos', 30) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;

  case p_periodo
    when 'dia' then
      v_inicio := p_fecha;
      v_fin := p_fecha + 1;
    when 'semana' then
      v_inicio := p_fecha - 6;
      v_fin := p_fecha + 1;
    when 'mes' then
      v_inicio := date_trunc('month', p_fecha::timestamp)::date;
      v_fin := (v_inicio + interval '1 month')::date;
  end case;

  return query
  with productos_detalle as (
    select linea.item ->> 'codigo' as codigo,
      linea.item ->> 'nombre' as producto,
      (linea.item ->> 'cantidad')::bigint as unidades
    from public.pedidos p
    cross join lateral jsonb_array_elements(p.lineas) as linea(item)
    where p.fecha >= (v_inicio::timestamp at time zone p_zona)
      and p.fecha < (v_fin::timestamp at time zone p_zona)
      and p.tipo = 'venta'
    union all
    select mv.codigo, m.nombre, abs(m.cantidad)::bigint
    from public.movimientos m
    join public.movimientos_ventas mv
      on mv.movimiento_fecha = m.created_at
      and mv.movimiento_usuario = m.usuario
      and mv.movimiento_nombre = m.nombre
      and mv.movimiento_cantidad = m.cantidad
    where m.created_at >= (v_inicio::timestamp at time zone p_zona)
      and m.created_at < (v_fin::timestamp at time zone p_zona)
      and m.cantidad < 0
      and not exists (
        select 1 from public.movimientos_comprobantes mc
        where mc.movimiento_fecha = m.created_at
          and mc.movimiento_usuario = m.usuario
          and mc.movimiento_nombre = m.nombre
          and mc.movimiento_cantidad = m.cantidad
      )
  ), productos as (
    select d.codigo, d.producto, sum(d.unidades)::bigint as unidades
    from productos_detalle d
    group by d.codigo, d.producto
  ), ordenados as (
    select p.codigo, p.producto, p.unidades,
      row_number() over (order by p.unidades desc, p.producto, p.codigo) as posicion
    from productos p
  ), segmentos as (
    select o.codigo, o.producto, o.unidades
    from ordenados o
    where o.posicion <= 8
    union all
    select null::text, 'Otros'::text, sum(o.unidades)::bigint
    from ordenados o
    where o.posicion > 8
    having count(*) > 0
  )
  select s.codigo, s.producto, s.unidades
  from segmentos s
  order by (s.codigo is null), s.unidades desc, s.producto;
end;
$$;

revoke all on function public.estadisticas_ventas(text, date, text) from public, anon;
revoke all on function public.productos_mas_vendidos(text, date, text) from public, anon;
grant execute on function public.estadisticas_ventas(text, date, text) to authenticated;
grant execute on function public.productos_mas_vendidos(text, date, text) to authenticated;

notify pgrst, 'reload schema';
