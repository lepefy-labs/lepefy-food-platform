-- MIGRATION 180: POIDS D'EMBALLAGE PAR TRANCHE (PAR TENANT)
--
-- Additive, sans backfill, sans activation : aucune ligne n'est créée. Un tenant
-- sans tranche se comporte exactement comme avant (netto + tare_g du carton pour
-- la bozza et la disponibilité, netto pour le devis provider).
--
-- Tranche = (min exclusif, max inclusif], évaluée sur le poids NET TOTAL de la
-- commande ; la dernière tranche est ouverte (max null). Le poids ajouté va au
-- poids envoyé au provider (devis sans forfait, disponibilité, bozza) et n'entre
-- jamais dans le prix du forfait, le découpage en colis ou le choix du carton.
-- Avec des tranches, tare_g est ignoré (jamais additionné).
--
-- RLS forcée, aucune policy : service role uniquement. Écriture par la seule RPC
-- replace_shipping_packaging_weight_bands (liste complète, atomique).
--
-- Rollback :
--   drop function public.replace_shipping_packaging_weight_bands(uuid, jsonb, uuid);
--   drop table public.shipping_packaging_weight_bands;
--   delete from public.audit_event_types where key = 'shipping.packaging_weight.updated'
--     (uniquement si aucun audit_events ne le référence).

begin;

create table if not exists public.shipping_packaging_weight_bands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  min_weight_g_exclusive integer not null check (min_weight_g_exclusive >= 0),
  max_weight_g_inclusive integer check (max_weight_g_inclusive is null or max_weight_g_inclusive > min_weight_g_exclusive),
  added_weight_g integer not null check (added_weight_g between 0 and 20000),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (tenant_id, min_weight_g_exclusive)
);

alter table public.shipping_packaging_weight_bands enable row level security;
alter table public.shipping_packaging_weight_bands force row level security;

revoke all on public.shipping_packaging_weight_bands from anon, authenticated;
grant select on public.shipping_packaging_weight_bands to service_role;

comment on table public.shipping_packaging_weight_bands is
  'Poids d''emballage ajouté au poids envoyé au provider, par tranche de poids net total de commande. Service role uniquement, écriture par RPC.';

create or replace function public.replace_shipping_packaging_weight_bands(
  p_tenant_id uuid,
  p_bands jsonb,
  p_actor_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_min integer := 0;
  v_count integer;
  v_position integer := 0;
  v_band jsonb;
  v_min integer;
  v_max integer;
  v_added integer;
begin
  if p_bands is null or jsonb_typeof(p_bands) <> 'array' then
    raise exception 'invalid_packaging_weight_bands';
  end if;
  v_count := jsonb_array_length(p_bands);
  if v_count > 20 then raise exception 'invalid_packaging_weight_bands'; end if;

  -- Sérialise deux enregistrements concurrents du même tenant.
  perform 1 from public.tenants where id = p_tenant_id for update;
  if not found then raise exception 'tenant_not_found'; end if;

  -- Validation complète avant toute écriture : tranches contiguës depuis 0,
  -- seule la dernière est ouverte.
  for v_band in select value from jsonb_array_elements(p_bands) loop
    v_position := v_position + 1;
    v_min := (v_band->>'min_weight_g_exclusive')::integer;
    v_max := (v_band->>'max_weight_g_inclusive')::integer;
    v_added := (v_band->>'added_weight_g')::integer;
    if v_min is distinct from v_expected_min or v_added is null or v_added not between 0 and 20000 then
      raise exception 'invalid_packaging_weight_bands';
    end if;
    if v_position = v_count then
      if v_max is not null then raise exception 'invalid_packaging_weight_bands'; end if;
    else
      if v_max is null or v_max <= v_min then raise exception 'invalid_packaging_weight_bands'; end if;
      v_expected_min := v_max;
    end if;
  end loop;

  delete from public.shipping_packaging_weight_bands where tenant_id = p_tenant_id;

  insert into public.shipping_packaging_weight_bands
    (tenant_id, min_weight_g_exclusive, max_weight_g_inclusive, added_weight_g, updated_by)
  select p_tenant_id, (value->>'min_weight_g_exclusive')::integer, (value->>'max_weight_g_inclusive')::integer,
         (value->>'added_weight_g')::integer, p_actor_id
  from jsonb_array_elements(p_bands);

  return v_count;
end;
$$;

revoke all on function public.replace_shipping_packaging_weight_bands(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.replace_shipping_packaging_weight_bands(uuid, jsonb, uuid) to service_role;

insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
  ('shipping.packaging_weight.updated', 'shipping', 'activity', 'notice', 'business')
on conflict (key) do nothing;

commit;
