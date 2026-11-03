-- MIGRATION 179: POLITIQUE GÉOGRAPHIQUE DE LIVRAISON PAR TENANT
--
-- Additive, sans backfill, sans activation : aucune ligne n'est créée. Un tenant
-- sans ligne se comporte exactement comme avant (destinations « actuelles »,
-- aucune restriction par conservation, repli provider inchangé).
--
--   destination_mode           current | eu | carrier_all | custom
--   included_countries         liste ISO2 (mode custom)
--   excluded_countries         exclusions explicites, valables pour tous les modes
--   provider_fallback_enabled  devis provider automatique pour un pays SANS forfait
--                              actif (ne remplace pas shipping_tariff_fallback, qui
--                              couvre aussi poids manquant / zone non couverte)
--   storage_rules              { dry|fresh|frozen: { mode: none|store_country|eu|custom,
--                                countries: [ISO2] } } — réutilise products.storage_type
--   policy_version             incrémenté à chaque écriture (invalide les devis signés)
--
-- RLS forcée, aucune policy : lecture/écriture par service role uniquement
-- (les routes admin vérifient shipping.view / shipping.manage).
--
-- Rollback : drop table public.tenant_shipping_geo_policy;

begin;

create table if not exists public.tenant_shipping_geo_policy (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  destination_mode text not null default 'current'
    check (destination_mode in ('current', 'eu', 'carrier_all', 'custom')),
  included_countries text[] not null default '{}',
  excluded_countries text[] not null default '{}',
  provider_fallback_enabled boolean not null default false,
  storage_rules jsonb not null default '{}'::jsonb,
  policy_version integer not null default 1 check (policy_version >= 1),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create or replace function public.is_valid_geo_country_list(p_list text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(c ~ '^[A-Z]{2}$'), true) and coalesce(cardinality(p_list), 0) <= 300
  from unnest(coalesce(p_list, '{}')) as c
$$;

alter table public.tenant_shipping_geo_policy
  add constraint tenant_shipping_geo_policy_included_check check (public.is_valid_geo_country_list(included_countries)),
  add constraint tenant_shipping_geo_policy_excluded_check check (public.is_valid_geo_country_list(excluded_countries)),
  add constraint tenant_shipping_geo_policy_storage_check check (jsonb_typeof(storage_rules) = 'object');

alter table public.tenant_shipping_geo_policy enable row level security;
alter table public.tenant_shipping_geo_policy force row level security;

revoke all on public.tenant_shipping_geo_policy from anon, authenticated;
grant select, insert, update on public.tenant_shipping_geo_policy to service_role;

comment on table public.tenant_shipping_geo_policy is
  'Politique géographique de livraison et restrictions par conservation (products.storage_type). Service role uniquement.';

commit;
