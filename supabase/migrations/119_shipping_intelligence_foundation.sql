-- ─── MIGRATION 119: SHIPPING INTELLIGENCE — DATA FOUNDATION ──────────────────
-- Couche provider-neutral de renseignement expédition, additive uniquement.
-- Aucune table existante n'est modifiée (tenants, orders, packaging_surcharges,
-- shipping_country_rules restent inchangées — zéro impact checkout).
--
-- 1. shipping_packaging_profiles — catalogue de boîtes par tenant (remplace
--    le modèle "une seule boîte implicite" de packaging_surcharges pour les
--    besoins de simulation ; packaging_surcharges continue de piloter le
--    calcul de livraison réel tant que ce n'est pas explicitement changé).
-- 2. shipping_zones — zones géographiques réutilisables par tenant (ex.
--    IT_SICILY), données saisies par le tenant — aucun mapping code postal
--    n'est inventé ici.
-- 3. shipping_quote_observations — dataset normalisé d'observations de devis
--    (synthétiques, devis réels, expéditions réelles). Jamais de clé API ni
--    de payload brut provider.
-- 4. shipping_simulation_campaigns / shipping_simulation_campaign_items —
--    campagnes de simulation bornées et reprenables.
-- 5. shipping_tariff_drafts — brouillons de tarifs commerciaux, jamais lus
--    par le checkout.

-- ─── 1. Profils d'emballage ───────────────────────────────────────────────
create table shipping_packaging_profiles (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  name           text not null,
  box_length_cm  int not null check (box_length_cm > 0),
  box_width_cm   int not null check (box_width_cm > 0),
  box_height_cm  int not null check (box_height_cm > 0),
  max_weight_g   int not null check (max_weight_g > 0),
  is_default     boolean not null default false,
  active         boolean not null default true,
  position       int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table shipping_packaging_profiles is
  'Catalogue de boîtes disponibles par tenant, utilisé par le laboratoire de simulation. '
  'N''alimente pas encore calculateShipping.ts (packaging_surcharges reste la source du calcul réel).';

create unique index shipping_packaging_profiles_one_default
  on shipping_packaging_profiles (tenant_id) where is_default;

alter table shipping_packaging_profiles enable row level security;

create policy "shipping_packaging_profiles_select_public"
  on shipping_packaging_profiles for select using (active = true);

-- GRANT explicites obligatoires (RLS seule ne suffit pas — cf. 050_shipping_country_rules.sql)
grant select on shipping_packaging_profiles to anon, authenticated;
grant select, insert, update, delete on shipping_packaging_profiles to service_role, authenticated;

create trigger shipping_packaging_profiles_updated_at before update on shipping_packaging_profiles
  for each row execute function update_updated_at();

-- ─── 2. Zones géographiques ───────────────────────────────────────────────
create table shipping_zones (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  code             text not null,
  country          text not null,
  postal_prefixes  text[] not null default '{}',
  active           boolean not null default true,
  position         int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique(tenant_id, code)
);

comment on table shipping_zones is
  'Zones géographiques définies par le tenant (ex. IT_SICILY) via préfixes de code postal saisis manuellement. '
  'Aucun mapping code postal → région n''est fourni par la plateforme : donnée d''entrée tenant.';

alter table shipping_zones enable row level security;

create policy "shipping_zones_select_public"
  on shipping_zones for select using (active = true);

grant select on shipping_zones to anon, authenticated;
grant select, insert, update, delete on shipping_zones to service_role, authenticated;

create trigger shipping_zones_updated_at before update on shipping_zones
  for each row execute function update_updated_at();

-- ─── 3. Campagnes de simulation (créées avant observations pour la FK) ────
create table shipping_simulation_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  name                text not null,
  status              text not null default 'draft' check (status in
                        ('draft','queued','running','completed','completed_with_errors','cancelled')),
  scenario_matrix     jsonb not null,
  concurrency_limit   int not null default 2 check (concurrency_limit between 1 and 4),
  total_scenarios     int not null default 0,
  completed_scenarios int not null default 0,
  failed_scenarios    int not null default 0,
  skipped_scenarios   int not null default 0,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz
);

comment on table shipping_simulation_campaigns is
  'Campagne de simulation bornée : matrice de scénarios (poids × profils × destinations), traitée par lots via '
  '/api/internal/shipping-campaign-worker (cron), jamais par un long appel HTTP synchrone.';

create index shipping_simulation_campaigns_tenant_status_idx
  on shipping_simulation_campaigns (tenant_id, status);

alter table shipping_simulation_campaigns enable row level security;
-- Aucune policy publique : ce sont des coûts fournisseur internes, accès admin uniquement via service_role.
grant select, insert, update, delete on shipping_simulation_campaigns to service_role;

-- ─── 4. Observations de devis (provider-neutral) ──────────────────────────
create table shipping_quote_observations (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references tenants(id) on delete cascade,
  provider                 text not null,
  source                   text not null check (source in ('synthetic_simulation','real_quote','real_shipment')),
  campaign_id              uuid references shipping_simulation_campaigns(id) on delete set null,
  origin_country           text not null,
  origin_postal_code       text not null,
  destination_country      text not null,
  destination_postal_code  text not null,
  destination_zone_code    text,
  num_parcels              int not null check (num_parcels > 0),
  parcels                  jsonb not null,
  total_weight_g           int not null check (total_weight_g > 0),
  packaging_profile_id     uuid references shipping_packaging_profiles(id) on delete set null,
  service_id               text,
  carrier                  text,
  service_name             text,
  base_price               numeric(10,2),
  tax_price                numeric(10,2),
  total_provider_cost      numeric(10,2),
  eligible                 boolean not null default true,
  exclusion_reason         text,
  observed_at              timestamptz not null default now(),
  request_hash             text not null,
  created_at               timestamptz not null default now()
);

comment on table shipping_quote_observations is
  'Dataset normalisé d''observations de devis expédition (synthétiques, devis réels, expéditions réelles). '
  'Jamais de clé API ni de payload brut provider. Jamais lu comme prix autoritaire — support de décision uniquement.';

create index shipping_quote_observations_tenant_provider_idx
  on shipping_quote_observations (tenant_id, provider, observed_at desc);
create index shipping_quote_observations_tenant_dest_weight_idx
  on shipping_quote_observations (tenant_id, destination_country, total_weight_g);
create index shipping_quote_observations_hash_idx
  on shipping_quote_observations (tenant_id, request_hash, observed_at desc);
create index shipping_quote_observations_campaign_idx
  on shipping_quote_observations (campaign_id);

alter table shipping_quote_observations enable row level security;
-- Aucune policy publique : coûts fournisseur internes, accès admin uniquement via service_role.
grant select, insert, update, delete on shipping_quote_observations to service_role;

-- ─── 5. Éléments de campagne (reprenables) ────────────────────────────────
create table shipping_simulation_campaign_items (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references shipping_simulation_campaigns(id) on delete cascade,
  tenant_id      uuid not null references tenants(id) on delete cascade,
  scenario       jsonb not null,
  status         text not null default 'pending' check (status in
                   ('pending','running','succeeded','failed','skipped_duplicate')),
  observation_id uuid references shipping_quote_observations(id) on delete set null,
  error          text,
  attempted_at   timestamptz,
  created_at     timestamptz not null default now()
);

comment on table shipping_simulation_campaign_items is
  'Un scénario résolu (poids, profil, destination) par ligne — la persistance par item rend la campagne '
  'reprenable après redémarrage/déploiement (le worker requery simplement status = pending).';

create index shipping_simulation_campaign_items_campaign_status_idx
  on shipping_simulation_campaign_items (campaign_id, status);

alter table shipping_simulation_campaign_items enable row level security;
grant select, insert, update, delete on shipping_simulation_campaign_items to service_role;

-- ─── 6. Brouillons de tarifs commerciaux ──────────────────────────────────
create table shipping_tariff_drafts (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id) on delete cascade,
  name                   text not null,
  status                 text not null default 'draft' check (status in ('draft','archived')),
  bands                  jsonb not null default '[]',
  zone_surcharges        jsonb not null default '{}',
  multi_parcel_strategy  jsonb,
  notes                  text,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table shipping_tariff_drafts is
  'Brouillons de stratégie tarifaire client (bandes de poids, surcharges de zone, stratégie multi-colis) '
  'analysés dans le laboratoire tarifaire. JAMAIS lus par le flux de checkout — activation hors périmètre.';

alter table shipping_tariff_drafts enable row level security;
grant select, insert, update, delete on shipping_tariff_drafts to service_role;

create trigger shipping_tariff_drafts_updated_at before update on shipping_tariff_drafts
  for each row execute function update_updated_at();

-- ─── Seed : un profil par défaut par tenant, dérivé de packaging_surcharges ─
-- Aucune conséquence sur le calcul réel : calculateShipping.ts continue de
-- lire packaging_surcharges directement, inchangé par cette migration.
insert into shipping_packaging_profiles
  (tenant_id, name, box_length_cm, box_width_cm, box_height_cm, max_weight_g, is_default, position)
select
  ps.tenant_id,
  'Standard',
  ps.box_length_cm,
  ps.box_width_cm,
  ps.box_height_cm,
  (ps.max_pack_kg * 1000)::int,
  true,
  0
from packaging_surcharges ps
where ps.active = true;

-- Rollback (additive uniquement, aucune donnée existante modifiée) :
-- BEGIN;
-- DROP TABLE shipping_simulation_campaign_items;
-- DROP TABLE shipping_quote_observations;
-- DROP TABLE shipping_simulation_campaigns;
-- DROP TABLE shipping_tariff_drafts;
-- DROP TABLE shipping_zones;
-- DROP TABLE shipping_packaging_profiles;
-- COMMIT;
