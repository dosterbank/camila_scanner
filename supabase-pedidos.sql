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
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

alter table public.clientes enable row level security;
alter table public.pedidos enable row level security;

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

create policy "Admins can read orders" on public.pedidos
  for select to authenticated using (public.usuario_es_admin());

create policy "Authenticated users can read cash closures" on public.cierres_caja
  for select to authenticated using (auth.uid() is not null);

revoke all on public.clientes, public.pedidos from public, anon, authenticated;
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
      'buscar_cliente', 'guardar_pedido', 'estadisticas_ventas',
      'ventas_caja_dia', 'resumen_caja_dia', 'historial_cierres_caja',
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
create function public.buscar_cliente(p_documento text, p_correo text)
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
    or (nullif(btrim(coalesce(p_documento, '')), '') is null
      and nullif(btrim(coalesce(p_correo, '')), '') is null) then
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
    )
  order by case
    when c.documento_normalizado =
      nullif(upper(regexp_replace(coalesce(p_documento, ''), '[^[:alnum:]]', '', 'g')), '') then 0
    else 1
  end
  limit 1;
end;
$$;

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
  p_correo text
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
      or coalesce(linea.item ->> 'tipo_precio', '') not in
        ('precio_normal', 'precio_en_vivo', 'precio_mayorista')
      or (
        linea.item -> 'precio_unitario' <> 'null'::jsonb
        and coalesce(linea.item ->> 'precio_unitario', '') !~ '^[0-9]{1,10}([.][0-9]{1,2})?$'
      )
      or coalesce(linea.item ->> 'subtotal', '') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$'
  ) then
    raise exception 'Una o mas lineas del pedido no son validas.';
  end if;
  if (
    select coalesce(sum((linea.item ->> 'cantidad')::integer), 0)
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
    where p.id is null
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
      ) <> (linea.item ->> 'subtotal')::numeric
  ) then
    raise exception 'El precio o subtotal de una linea no coincide con los precios vigentes.';
  end if;

  select id into v_pedido_id
  from public.pedidos
  where numero = btrim(p_numero);
  if v_pedido_id is not null then
    return v_pedido_id;
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
  if v_cliente_documento is not null and v_cliente_correo is not null
    and v_cliente_documento <> v_cliente_correo then
    raise exception 'La cedula/RUC y el correo pertenecen a clientes distintos. Busca el cliente correcto antes de guardar.';
  end if;

  v_cliente_id := coalesce(v_cliente_documento, v_cliente_correo);
  v_usuario := coalesce(nullif(auth.jwt() ->> 'email', ''), auth.uid()::text);
  if v_cliente_id is not null then
    update public.clientes
    set nombre = coalesce(nombre, nullif(btrim(p_cliente_nombre), '')),
        documento = coalesce(documento, nullif(btrim(p_documento), '')),
        telefono = coalesce(telefono, nullif(btrim(p_telefono), '')),
        correo = coalesce(correo, nullif(btrim(p_correo), '')),
        actualizado_en = now()
    where id = v_cliente_id;
  elsif v_documento_normalizado is not null or v_correo_normalizado is not null then
    insert into public.clientes (nombre, documento, telefono, correo)
    values (
      coalesce(nullif(btrim(p_cliente_nombre), ''), 'Cliente'),
      nullif(btrim(p_documento), ''),
      nullif(btrim(p_telefono), ''),
      nullif(btrim(p_correo), '')
    )
    returning id into v_cliente_id;
  end if;

  insert into public.pedidos (
    numero, fecha, cliente_id, cliente_nombre, documento, telefono, correo,
    unidades, total, lineas, usuario
  )
  values (
    btrim(p_numero), now(), v_cliente_id,
    coalesce(nullif(btrim(p_cliente_nombre), ''), 'Consumidor final'),
    nullif(btrim(p_documento), ''), nullif(btrim(p_telefono), ''),
    nullif(btrim(p_correo), ''), p_unidades, p_total, p_lineas,
    v_usuario
  )
  on conflict (numero) do nothing
  returning id into v_pedido_id;

  if v_pedido_id is null then
    select id into v_pedido_id
    from public.pedidos
    where numero = btrim(p_numero);
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
    group by 1
  )
  select b.dia, coalesce(v.importe, 0), coalesce(v.cantidad, 0)
  from buckets b left join ventas v on v.dia = b.dia
  order by b.dia;
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
  return query
  select p.numero, p.fecha, p.usuario, p.cliente_nombre, p.unidades, p.total
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
  return query
  select count(*)::bigint, coalesce(sum(p.unidades), 0)::bigint, coalesce(sum(p.total), 0)::numeric
  from public.pedidos p
  where p.fecha >= (p_fecha::timestamp at time zone p_zona)
    and p.fecha < ((p_fecha + 1)::timestamp at time zone p_zona);
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

  select count(*)::integer, coalesce(sum(p.unidades), 0)::integer, coalesce(sum(p.total), 0)::numeric(12, 2)
  into v_pedidos, v_unidades, v_total
  from public.pedidos p
  where p.fecha >= (p_fecha::timestamp at time zone p_zona)
    and p.fecha < ((p_fecha + 1)::timestamp at time zone p_zona);

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
revoke all on function public.ventas_caja_dia(date, text) from public, anon;
revoke all on function public.resumen_caja_dia(date, text) from public, anon;
revoke all on function public.historial_cierres_caja(date) from public, anon;
revoke all on function public.detalle_pedido(text) from public, anon;
revoke all on function public.cerrar_caja_sin_novedades(date, text) from public, anon;
grant execute on function public.estadisticas_ventas(text, date, text) to authenticated;
grant execute on function public.ventas_caja_dia(date, text) to authenticated;
grant execute on function public.resumen_caja_dia(date, text) to authenticated;
grant execute on function public.historial_cierres_caja(date) to authenticated;
grant execute on function public.detalle_pedido(text) to authenticated;
grant execute on function public.cerrar_caja_sin_novedades(date, text) to authenticated;

revoke all on function public.buscar_cliente(text, text) from public, anon;
revoke all on function public.guardar_pedido(text, timestamptz, numeric, integer, jsonb, text, text, text, text, text) from public, anon;
grant execute on function public.buscar_cliente(text, text) to authenticated;
grant execute on function public.guardar_pedido(text, timestamptz, numeric, integer, jsonb, text, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
