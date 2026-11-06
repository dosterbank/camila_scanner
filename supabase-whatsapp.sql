-- WhatsApp-only Supabase helper. Does not create or alter inventory, products, or orders.
-- Run this file separately when configuring the local n8n WhatsApp integration.

create or replace function public.usuario_es_personal()
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
      and nullif(btrim(p.rol), '') is not null
  );
$$;

revoke all on function public.usuario_es_personal() from public, anon;
grant execute on function public.usuario_es_personal() to authenticated;

notify pgrst, 'reload schema';
