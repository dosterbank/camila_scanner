-- Run in Supabase SQL Editor to enable customer lookup and saved sales.
-- Re-run after the initial setup to remove direct write access to customers/orders.
-- This does not replace provider-level WAF/DDoS controls.
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  documento text,
  telefono text,
  correo text,
  documento_normalizado text generated always as (
    nullif(upper(regexp_replace(coalesce(documento, ''), '[^[:alnum:]]', '', 'g')), '')
  ) stored,
  correo_normalizado text generated always as (
    nullif(lower(btrim(coalesce(correo, ''))), '')
  ) stored,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index if not exists clientes_documento_normalizado_uidx
  on public.clientes (documento_normalizado)
  where documento_normalizado is not null;
create unique index if not exists clientes_correo_normalizado_uidx
  on public.clientes (correo_normalizado)
  where correo_normalizado is not null;

create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  fecha timestamptz not null,
  cliente_id uuid references public.clientes(id) on delete set null,
  cliente_nombre text not null default 'Consumidor final',
  documento text,
  telefono text,
  correo text,
  unidades integer not null check (unidades >= 0),
  total numeric(12, 2) not null check (total >= 0),
  lineas jsonb not null check (jsonb_typeof(lineas) = 'array'),
  usuario text not null,
  tipo text not null default 'venta',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.combos_caja (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 2 and 100),
  precio numeric(12, 2) not null check (precio >= 0),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create table if not exists public.combo_productos (
  combo_id uuid not null references public.combos_caja(id),
  codigo text not null,
  cantidad integer not null check (cantidad > 0),
  primary key (combo_id, codigo)
);

alter table public.pedidos add column if not exists tipo text not null default 'venta';
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'pedidos_tipo_check'
      and conrelid = 'public.pedidos'::regclass
  ) then
    alter table public.pedidos
      add constraint pedidos_tipo_check check (tipo in ('venta', 'entrada'));
  end if;
end;
$$;

alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;
alter table public.combos_caja enable row level security;
alter table public.combo_productos enable row level security;

create table if not exists public.rpc_rate_limits (
  user_id uuid not null,
  operation text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (user_id, operation)
);
alter table public.rpc_rate_limits enable row level security;
revoke all on public.rpc_rate_limits from public, anon, authenticated;

create table if not exists public.cierres_caja (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  cerrado_en timestamptz not null default now(),
  cerrado_por_id uuid not null,
  cerrado_por text not null,
  pedidos integer not null check (pedidos >= 0),
  unidades integer not null check (unidades >= 0),
  total numeric(12, 2) not null check (total >= 0),
  novedades text not null default 'Sin novedades'
);
alter table public.cierres_caja enable row level security;
create index if not exists pedidos_fecha_idx on public.pedidos (fecha desc);
create index if not exists cierres_caja_fecha_idx on public.cierres_caja (fecha, cerrado_en desc);

-- Remove previous policies; expose only order reads directly.
-- Customer lookup and writes are limited to the RPC functions below.
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename in ('clientes', 'pedidos', 'cierres_caja')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end;
$$;

create or replace function public.usuario_es_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = auth.uid()
      and lower(btrim(p.rol)) = 'admin'
  );
$$;

revoke all on function public.usuario_es_admin() from public, anon;
grant execute on function public.usuario_es_admin() to authenticated;

create or replace function public.listar_combos()
returns table (
  combo_id uuid, nombre text, precio numeric, codigo text, producto text, cantidad integer, stock integer
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  return query
  select c.id, c.nombre, c.precio, cp.codigo, p.nombre, cp.cantidad, p.cantidad
  from public.combos_caja c
  join public.combo_productos cp on cp.combo_id = c.id
  join public.productos p on p.codigo = cp.codigo
  where c.activo
  order by c.nombre, cp.codigo;
end;
$$;

create or replace function public.guardar_combo(
  p_id uuid, p_nombre text, p_precio numeric, p_componentes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not public.usuario_es_admin() then
    raise exception 'Solo administradores pueden guardar combos.';
  end if;
  if p_nombre is null or length(btrim(p_nombre)) not between 2 and 100
    or p_precio is null or p_precio < 0 or p_precio > 9999999999.99
    or p_precio <> round(p_precio, 2)
    or p_componentes is null or jsonb_typeof(p_componentes) <> 'array'
    or jsonb_array_length(case when jsonb_typeof(p_componentes) = 'array'
      then p_componentes else '[]'::jsonb end) not between 1 and 100 then
    raise exception 'Los datos del combo no son validos.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_componentes) as componente(item)
    where jsonb_typeof(componente.item) <> 'object'
      or length(coalesce(componente.item ->> 'codigo', '')) not between 1 and 50
      or coalesce(componente.item ->> 'cantidad', '') !~ '^[1-9][0-9]{0,5}$'
  ) or (
    select count(*) <> count(distinct componente.item ->> 'codigo')
    from jsonb_array_elements(p_componentes) as componente(item)
  ) then
    raise exception 'Los productos o cantidades del combo no son validos.';
  end if;
  if (
    select sum((componente.item ->> 'cantidad')::numeric)
    from jsonb_array_elements(p_componentes) as componente(item)
  ) > 999999 then
    raise exception 'La suma de unidades del combo excede el limite permitido.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_componentes) as componente(item)
    left join public.productos p on p.codigo = componente.item ->> 'codigo'
    where p.id is null
  ) then
    raise exception 'Uno o mas productos del combo ya no existen.';
  end if;

  if p_id is null then
    insert into public.combos_caja (nombre, precio)
    values (btrim(p_nombre), p_precio)
    returning id into v_id;
  else
    update public.combos_caja
    set nombre = btrim(p_nombre), precio = p_precio, actualizado_en = now()
    where id = p_id and activo
    returning id into v_id;
    if v_id is null then
      raise exception 'El combo no existe o ya fue eliminado.';
    end if;
    delete from public.combo_productos where combo_id = v_id;
  end if;
  insert into public.combo_productos (combo_id, codigo, cantidad)
  select v_id, componente.item ->> 'codigo', (componente.item ->> 'cantidad')::integer
  from jsonb_array_elements(p_componentes) as componente(item);
  return v_id;
end;
$$;

create or replace function public.eliminar_combo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null or not public.usuario_es_admin() then
    raise exception 'Solo administradores pueden eliminar combos.';
  end if;
  update public.combos_caja set activo = false, actualizado_en = now()
  where id = p_id and activo;
  if not found then
    raise exception 'El combo no existe o ya fue eliminado.';
  end if;
end;
$$;

revoke all on function public.listar_combos() from public, anon;
revoke all on function public.guardar_combo(uuid, text, numeric, jsonb) from public, anon;
revoke all on function public.eliminar_combo(uuid) from public, anon;
grant execute on function public.listar_combos() to authenticated;
grant execute on function public.guardar_combo(uuid, text, numeric, jsonb) to authenticated;
grant execute on function public.eliminar_combo(uuid) to authenticated;

create policy "Admins can read orders" on public.pedidos
  for select to authenticated using (public.usuario_es_admin());

create policy "Authenticated users can read cash closures" on public.cierres_caja
  for select to authenticated using (auth.uid() is not null);

revoke all on public.clientes, public.pedidos from public, anon, authenticated;
revoke all on public.combos_caja, public.combo_productos from public, anon, authenticated;
revoke all on public.cierres_caja from public, anon, authenticated;
grant select on public.pedidos to authenticated;
grant select on public.cierres_caja to authenticated;

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
      'detalle_pedido', 'cerrar_caja'
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

drop function if exists public.buscar_cliente(text, text);
drop function if exists public.buscar_cliente(text, text, text);
create function public.buscar_cliente(p_documento text, p_correo text, p_nombre text)
returns table (nombre text, documento text, telefono text, correo text, rate_limited boolean)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if length(coalesce(p_documento, '')) > 50
    or length(coalesce(p_correo, '')) > 254
    or length(coalesce(p_nombre, '')) > 200
    or (nullif(btrim(coalesce(p_documento, '')), '') is null
      and nullif(btrim(coalesce(p_correo, '')), '') is null
      and nullif(btrim(coalesce(p_nombre, '')), '') is null) then
    raise exception 'Criterio de busqueda no valido.';
  end if;

  if not public.comprobar_limite_rpc('buscar_cliente', 20) then
    nombre := null;
    documento := null;
    telefono := null;
    correo := null;
    rate_limited := true;
    return next;
    return;
  end if;

  return query
  select c.nombre, c.documento, c.telefono, c.correo, false
  from public.clientes c
  where (
      (
        nullif(upper(regexp_replace(coalesce(p_documento, ''), '[^[:alnum:]]', '', 'g')), '') is not null
        and c.documento_normalizado =
          nullif(upper(regexp_replace(coalesce(p_documento, ''), '[^[:alnum:]]', '', 'g')), '')
      )
      or (
        nullif(lower(btrim(coalesce(p_correo, ''))), '') is not null
        and c.correo_normalizado = nullif(lower(btrim(coalesce(p_correo, ''))), '')
      )
      or (
        length(btrim(coalesce(p_nombre, ''))) >= 2
        and position(lower(btrim(p_nombre)) in lower(c.nombre)) > 0
      )
    )
  order by case
    when c.documento_normalizado =
      nullif(upper(regexp_replace(coalesce(p_documento, ''), '[^[:alnum:]]', '', 'g')), '') then 0
    when c.correo_normalizado = nullif(lower(btrim(coalesce(p_correo, ''))), '') then 1
    when lower(c.nombre) = lower(btrim(coalesce(p_nombre, ''))) then 2
    else 3
  end, c.actualizado_en desc
  limit 10;
end;
$$;

drop function if exists public.guardar_pedido(text, timestamptz, numeric, integer, jsonb, text, text, text, text, text);
create or replace function public.guardar_pedido(
  p_numero text,
  p_fecha timestamptz,
  p_total numeric,
  p_unidades integer,
  p_lineas jsonb,
  p_usuario text,
  p_cliente_nombre text,
  p_documento text,
  p_telefono text,
  p_correo text,
  p_tipo text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_documento_normalizado text;
  v_correo_normalizado text;
  v_cliente_documento uuid;
  v_cliente_correo uuid;
  v_cliente_id uuid;
  v_pedido_id uuid;
  v_usuario text;
  v_usuario_pedido text;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if not public.comprobar_limite_rpc('guardar_pedido', 30) then
    return null;
  end if;
  if nullif(btrim(p_numero), '') is null or length(p_numero) > 40
    or p_numero !~ '^C-[0-9]{8}-[0-9]{9}$'
    or length(coalesce(p_cliente_nombre, '')) > 200
    or length(coalesce(p_documento, '')) > 50
    or length(coalesce(p_telefono, '')) > 40
    or length(coalesce(p_correo, '')) > 254
    or length(coalesce(p_usuario, '')) > 254
    or p_tipo is null or p_tipo not in ('venta', 'entrada')
    or p_fecha is null
    or p_total is null or p_total < 0 or p_total > 9999999999.99
    or p_unidades is null or p_unidades < 0 or p_unidades > 999999
    or p_lineas is null
    or jsonb_typeof(p_lineas) <> 'array'
    or jsonb_array_length(p_lineas) < 1
    or jsonb_array_length(p_lineas) > 300
    or octet_length(p_lineas::text) > 131072 then
    raise exception 'Los datos del pedido no son validos o exceden el limite permitido.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lineas) as linea(item)
    where jsonb_typeof(linea.item) <> 'object'
      or not (linea.item ? 'precio_unitario')
      or length(coalesce(linea.item ->> 'codigo', '')) not between 1 and 50
      or length(coalesce(linea.item ->> 'nombre', '')) > 200
      or coalesce(linea.item ->> 'cantidad', '') !~ '^[1-9][0-9]{0,5}$'
      or coalesce(linea.item ->> 'tipo_linea', 'producto') not in ('producto', 'combo')
      or (
        coalesce(linea.item ->> 'tipo_linea', 'producto') = 'producto'
        and (
          coalesce(linea.item ->> 'tipo_precio', '') not in
            ('precio_normal', 'precio_en_vivo', 'precio_mayorista')
          or (
            linea.item -> 'precio_unitario' <> 'null'::jsonb
            and coalesce(linea.item ->> 'precio_unitario', '') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
          )
        )
      )
      or (
        linea.item ->> 'tipo_linea' = 'combo'
        and (
          coalesce(linea.item ->> 'combo_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          or coalesce(linea.item ->> 'codigo', '') <> 'COMBO-' || coalesce(linea.item ->> 'combo_id', '')
          or coalesce(linea.item ->> 'tipo_precio', '') <> 'combo_fijo'
          or coalesce(linea.item ->> 'unidades', '') !~ '^[1-9][0-9]{0,6}$'
          or jsonb_typeof(linea.item -> 'componentes') <> 'array'
          or jsonb_array_length(case when jsonb_typeof(linea.item -> 'componentes') = 'array'
            then linea.item -> 'componentes' else '[]'::jsonb end) not between 1 and 100
          or coalesce(linea.item ->> 'precio_unitario', '') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
        )
      )
      or coalesce(linea.item ->> 'subtotal', '') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$'
  ) then
    raise exception 'Una o mas lineas del pedido no son validas.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lineas) as linea(item)
    where linea.item ->> 'tipo_linea' = 'combo'
      and (
        not exists (
          select 1
          from public.combos_caja c
          where c.id = (linea.item ->> 'combo_id')::uuid
            and c.activo
            and c.nombre = linea.item ->> 'nombre'
            and c.precio = (linea.item ->> 'precio_unitario')::numeric
            and round(c.precio * (linea.item ->> 'cantidad')::integer, 2)
              = (linea.item ->> 'subtotal')::numeric
            and (select sum(cp.cantidad) * (linea.item ->> 'cantidad')::integer
              from public.combo_productos cp
              where cp.combo_id = c.id) = (linea.item ->> 'unidades')::integer
            and linea.item -> 'componentes' = (
              select jsonb_agg(jsonb_build_object(
                'codigo', cp.codigo, 'nombre', p.nombre, 'cantidad', cp.cantidad
              ) order by cp.codigo)
              from public.combo_productos cp
              join public.productos p on p.codigo = cp.codigo
              where cp.combo_id = c.id
            )
        )
      )
  ) then
    raise exception 'El precio o los productos de un combo ya no coinciden con la configuracion vigente.';
  end if;
  if (
    select coalesce(sum(case when linea.item ->> 'tipo_linea' = 'combo'
      then (linea.item ->> 'unidades')::integer
      else (linea.item ->> 'cantidad')::integer end), 0)
    from jsonb_array_elements(p_lineas) as linea(item)
  ) <> p_unidades
  or (
    select round(coalesce(sum((linea.item ->> 'subtotal')::numeric), 0), 2)
    from jsonb_array_elements(p_lineas) as linea(item)
  ) <> p_total then
    raise exception 'El total o las unidades no coinciden con las lineas del pedido.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lineas) as linea(item)
    left join public.productos p on p.codigo = linea.item ->> 'codigo'
    where coalesce(linea.item ->> 'tipo_linea', 'producto') = 'producto'
      and (p.id is null
      or coalesce(linea.item ->> 'nombre', '') <> coalesce(p.nombre, '')
      or (case linea.item ->> 'tipo_precio'
        when 'precio_normal' then p.precio_normal
        when 'precio_en_vivo' then p.precio_en_vivo
        when 'precio_mayorista' then p.precio_mayorista
      end) is distinct from (linea.item ->> 'precio_unitario')::numeric
      or round(
        coalesce((linea.item ->> 'precio_unitario')::numeric, 0)
          * (linea.item ->> 'cantidad')::integer,
        2
      ) <> (linea.item ->> 'subtotal')::numeric)
  ) then
    raise exception 'El precio o subtotal de una linea no coincide con los precios vigentes.';
  end if;

  v_usuario := coalesce(nullif(auth.jwt() ->> 'email', ''), auth.uid()::text);
  select id, usuario into v_pedido_id, v_usuario_pedido
  from public.pedidos
  where numero = btrim(p_numero)
  for update;
  if v_pedido_id is not null and v_usuario_pedido <> v_usuario then
    raise exception 'No tienes permiso para modificar este comprobante.';
  end if;
  v_documento_normalizado :=
    nullif(upper(regexp_replace(coalesce(p_documento, ''), '[^[:alnum:]]', '', 'g')), '');
  v_correo_normalizado := nullif(lower(btrim(coalesce(p_correo, ''))), '');

  if v_documento_normalizado is not null then
    select id into v_cliente_documento
    from public.clientes
    where documento_normalizado = v_documento_normalizado;
  end if;
  if v_correo_normalizado is not null then
    select id into v_cliente_correo
    from public.clientes
    where correo_normalizado = v_correo_normalizado;
  end if;
  if v_cliente_documento is null and v_cliente_correo is null
    and nullif(btrim(coalesce(p_cliente_nombre, '')), '') is not null
    and lower(btrim(p_cliente_nombre)) <> 'consumidor final' then
    select id into v_cliente_id
    from public.clientes
    where lower(btrim(nombre)) = lower(btrim(p_cliente_nombre))
    order by actualizado_en desc
    limit 1;
  end if;
  if v_cliente_documento is not null and v_cliente_correo is not null
    and v_cliente_documento <> v_cliente_correo then
    raise exception 'La cedula/RUC y el correo pertenecen a clientes distintos. Busca el cliente correcto antes de guardar.';
  end if;

  v_cliente_id := coalesce(v_cliente_documento, v_cliente_correo, v_cliente_id);
  if v_cliente_id is not null then
    update public.clientes
    set nombre = coalesce(nullif(btrim(p_cliente_nombre), ''), nombre),
        documento = coalesce(nullif(btrim(p_documento), ''), documento),
        telefono = coalesce(nullif(btrim(p_telefono), ''), telefono),
        correo = coalesce(nullif(btrim(p_correo), ''), correo),
        actualizado_en = now()
    where id = v_cliente_id;
  elsif nullif(btrim(coalesce(p_cliente_nombre, '')), '') is not null
    or v_documento_normalizado is not null or v_correo_normalizado is not null
    or nullif(btrim(coalesce(p_telefono, '')), '') is not null then
    insert into public.clientes (nombre, documento, telefono, correo)
    values (
      coalesce(nullif(btrim(p_cliente_nombre), ''), 'Cliente'),
      nullif(btrim(p_documento), ''),
      nullif(btrim(p_telefono), ''),
      nullif(btrim(p_correo), '')
    )
    returning id into v_cliente_id;
  end if;

  if v_pedido_id is not null then
    update public.pedidos
    set fecha = p_fecha, cliente_id = v_cliente_id,
        cliente_nombre = coalesce(nullif(btrim(p_cliente_nombre), ''), 'Consumidor final'),
        documento = nullif(btrim(p_documento), ''),
        telefono = nullif(btrim(p_telefono), ''),
        correo = nullif(btrim(p_correo), ''),
        unidades = p_unidades, total = p_total, lineas = p_lineas, tipo = p_tipo,
        actualizado_en = now()
    where id = v_pedido_id;
  else
    insert into public.pedidos (
      numero, fecha, cliente_id, cliente_nombre, documento, telefono, correo,
      unidades, total, lineas, usuario, tipo
    )
    values (
      btrim(p_numero), p_fecha, v_cliente_id,
      coalesce(nullif(btrim(p_cliente_nombre), ''), 'Consumidor final'),
      nullif(btrim(p_documento), ''), nullif(btrim(p_telefono), ''),
      nullif(btrim(p_correo), ''), p_unidades, p_total, p_lineas,
      v_usuario, p_tipo
    )
    on conflict (numero) do update set
      fecha = excluded.fecha, cliente_id = excluded.cliente_id,
      cliente_nombre = excluded.cliente_nombre, documento = excluded.documento,
      telefono = excluded.telefono, correo = excluded.correo,
      unidades = excluded.unidades, total = excluded.total,
      lineas = excluded.lineas, tipo = excluded.tipo, actualizado_en = now()
    where public.pedidos.usuario = v_usuario
    returning id into v_pedido_id;
    if v_pedido_id is null then
      raise exception 'No tienes permiso para modificar este comprobante.';
    end if;
  end if;
  return v_pedido_id;
end;
$$;

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
  ), ventas as (
    select date_trunc(v_unidad, p.fecha at time zone p_zona)::date as dia,
      sum(p.total)::numeric as importe, count(*)::bigint as cantidad
    from public.pedidos p
    where p.fecha >= (v_inicio::timestamp at time zone p_zona)
      and p.fecha < (v_fin::timestamp at time zone p_zona)
      and p.tipo = 'venta'
    group by 1
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
  with productos as (
    select linea.item ->> 'codigo' as codigo,
      linea.item ->> 'nombre' as producto,
      sum((linea.item ->> 'cantidad')::bigint)::bigint as unidades
    from public.pedidos p
    cross join lateral jsonb_array_elements(p.lineas) as linea(item)
    where p.fecha >= (v_inicio::timestamp at time zone p_zona)
      and p.fecha < (v_fin::timestamp at time zone p_zona)
      and p.tipo = 'venta'
    group by linea.item ->> 'codigo', linea.item ->> 'nombre'
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

create or replace function public.ventas_caja_dia(p_fecha date, p_zona text)
returns table (
  numero text, fecha timestamptz, usuario text, cliente_nombre text, unidades integer, total numeric
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inicio timestamptz;
  v_fin timestamptz;
  v_ultimo_cierre timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_fecha is null
    or p_zona is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zona) then
    raise exception 'Fecha o zona horaria no validas.';
  end if;
  if not public.comprobar_limite_rpc('ventas_caja_dia', 30) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;
  v_inicio := p_fecha::timestamp at time zone p_zona;
  v_fin := (p_fecha + 1)::timestamp at time zone p_zona;
  select max(c.cerrado_en) into v_ultimo_cierre
  from public.cierres_caja c
  where c.cerrado_en < v_fin;
  return query
  select p.numero, p.fecha, p.usuario, p.cliente_nombre, p.unidades, p.total
  from public.pedidos p
  where p.fecha < v_fin
    and (p.fecha > coalesce(v_ultimo_cierre, v_inicio)
      or (v_ultimo_cierre is null and p.fecha = v_inicio))
    and p.tipo = 'venta'
  order by p.fecha desc
  limit 5000;
end;
$$;

drop function if exists public.comprobantes_dia(date, text);
create function public.comprobantes_dia(p_fecha date, p_zona text)
returns table (
  numero text, fecha timestamptz, usuario text, cliente_nombre text, tipo text,
  unidades integer, total numeric
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_fecha is null
    or p_zona is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zona) then
    raise exception 'Fecha o zona horaria no validas.';
  end if;
  if not public.comprobar_limite_rpc('comprobantes_dia', 30) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;
  return query
  select p.numero, p.fecha, p.usuario, p.cliente_nombre, p.tipo, p.unidades, p.total
  from public.pedidos p
  where p.fecha >= (p_fecha::timestamp at time zone p_zona)
    and p.fecha < ((p_fecha + 1)::timestamp at time zone p_zona)
  order by p.fecha desc
  limit 5000;
end;
$$;

create or replace function public.resumen_caja_dia(p_fecha date, p_zona text)
returns table (pedidos bigint, unidades bigint, total numeric)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_inicio timestamptz;
  v_fin timestamptz;
  v_ultimo_cierre timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_fecha is null
    or p_zona is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zona) then
    raise exception 'Fecha o zona horaria no validas.';
  end if;
  if not public.comprobar_limite_rpc('resumen_caja_dia', 30) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;
  v_inicio := p_fecha::timestamp at time zone p_zona;
  v_fin := (p_fecha + 1)::timestamp at time zone p_zona;
  select max(c.cerrado_en) into v_ultimo_cierre
  from public.cierres_caja c
  where c.cerrado_en < v_fin;
  return query
  select count(*)::bigint, coalesce(sum(p.unidades), 0)::bigint, coalesce(sum(p.total), 0)::numeric
  from public.pedidos p
  where p.fecha < v_fin
    and (p.fecha > coalesce(v_ultimo_cierre, v_inicio)
      or (v_ultimo_cierre is null and p.fecha = v_inicio))
    and p.tipo = 'venta';
end;
$$;

create or replace function public.historial_cierres_caja(p_fecha date)
returns table (
  cerrado_en timestamptz, cerrado_por text, pedidos integer, unidades integer, total numeric, novedades text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_fecha is null then
    raise exception 'La fecha no es valida.';
  end if;
  if not public.comprobar_limite_rpc('historial_cierres_caja', 30) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;
  return query
  select c.cerrado_en, c.cerrado_por, c.pedidos, c.unidades, c.total, c.novedades
  from public.cierres_caja c
  where c.fecha = p_fecha
  order by c.cerrado_en desc
  limit 100;
end;
$$;

create or replace function public.detalle_pedido(p_numero text)
returns table (numero text, cliente_nombre text, total numeric, lineas jsonb)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_numero text := p_numero;
begin
  if auth.uid() is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_numero is null or length(p_numero) > 40
    or p_numero !~ '^C-[0-9]{8}-[0-9]{9}$' then
    raise exception 'El numero de pedido no es valido.';
  end if;
  if not public.comprobar_limite_rpc('detalle_pedido', 60) then
    raise exception 'Demasiadas consultas. Espera un minuto e intenta de nuevo.';
  end if;
  return query
  select p.numero, p.cliente_nombre, p.total, p.lineas
  from public.pedidos p
  where p.numero = v_numero
  limit 1;
end;
$$;

create or replace function public.cerrar_caja_sin_novedades(p_fecha date, p_zona text)
returns table (
  id uuid, cerrado_en timestamptz, cerrado_por text, pedidos integer, unidades integer,
  total numeric, novedades text
)
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_email text;
  v_pedidos integer;
  v_unidades integer;
  v_total numeric(12, 2);
  v_inicio timestamptz;
  v_fin timestamptz;
  v_ultimo_cierre timestamptz;
begin
  if v_usuario is null then
    raise exception 'Se requiere una sesion iniciada.';
  end if;
  if p_fecha is null
    or p_zona is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zona) then
    raise exception 'Fecha o zona horaria no validas.';
  end if;
  if p_fecha > (now() at time zone p_zona)::date then
    raise exception 'No se puede cerrar una fecha futura.';
  end if;
  if not public.comprobar_limite_rpc('cerrar_caja', 10) then
    raise exception 'Demasiados cierres. Espera un minuto e intenta de nuevo.';
  end if;

  v_inicio := p_fecha::timestamp at time zone p_zona;
  v_fin := (p_fecha + 1)::timestamp at time zone p_zona;
  select max(c.cerrado_en) into v_ultimo_cierre
  from public.cierres_caja c
  where c.cerrado_en < v_fin;
  select count(*)::integer, coalesce(sum(p.unidades), 0)::integer, coalesce(sum(p.total), 0)::numeric(12, 2)
  into v_pedidos, v_unidades, v_total
  from public.pedidos p
  where p.fecha < v_fin
    and (p.fecha > coalesce(v_ultimo_cierre, v_inicio)
      or (v_ultimo_cierre is null and p.fecha = v_inicio))
    and p.tipo = 'venta';

  v_email := coalesce(nullif(auth.jwt() ->> 'email', ''), v_usuario::text);
  return query
  insert into public.cierres_caja as cierre (
    fecha, cerrado_por_id, cerrado_por, pedidos, unidades, total, novedades
  )
  values (p_fecha, v_usuario, v_email, v_pedidos, v_unidades, v_total, 'Sin novedades')
  returning cierre.id, cierre.cerrado_en, cierre.cerrado_por,
    cierre.pedidos, cierre.unidades, cierre.total, cierre.novedades;
end;
$$;

revoke all on function public.estadisticas_ventas(text, date, text) from public, anon;
revoke all on function public.productos_mas_vendidos(text, date, text) from public, anon;
revoke all on function public.ventas_caja_dia(date, text) from public, anon;
revoke all on function public.comprobantes_dia(date, text) from public, anon;
revoke all on function public.resumen_caja_dia(date, text) from public, anon;
revoke all on function public.historial_cierres_caja(date) from public, anon;
revoke all on function public.detalle_pedido(text) from public, anon;
revoke all on function public.cerrar_caja_sin_novedades(date, text) from public, anon;
grant execute on function public.estadisticas_ventas(text, date, text) to authenticated;
grant execute on function public.productos_mas_vendidos(text, date, text) to authenticated;
grant execute on function public.ventas_caja_dia(date, text) to authenticated;
grant execute on function public.comprobantes_dia(date, text) to authenticated;
grant execute on function public.resumen_caja_dia(date, text) to authenticated;
grant execute on function public.historial_cierres_caja(date) to authenticated;
grant execute on function public.detalle_pedido(text) to authenticated;
grant execute on function public.cerrar_caja_sin_novedades(date, text) to authenticated;

revoke all on function public.buscar_cliente(text, text, text) from public, anon;
revoke all on function public.guardar_pedido(text, timestamptz, numeric, integer, jsonb, text, text, text, text, text, text) from public, anon;
grant execute on function public.buscar_cliente(text, text, text) to authenticated;
grant execute on function public.guardar_pedido(text, timestamptz, numeric, integer, jsonb, text, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
