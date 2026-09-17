-- ─── MIGRATION 114: ZONES DE LIVRAISON — LOCATION MATÉRIEL ───────────────────
-- Le module location (052/061) ne supporte que le retrait en boutique.
-- Cette migration ajoute la possibilité de livraison : le tenant active la
-- livraison pour une liste de pays (macro-zone), puis configure des zones
-- précises (préfixe CP / ville / pays) avec un montant fixe — appliqué
-- automatiquement au total si l'adresse du client matche une zone. Si le pays
-- est autorisé mais qu'aucune zone précise ne matche, le supplément reste
-- "à évaluer" (voir 115_rental_delivery_fulfillment.sql).

-- Mêmes flags d'activation indépendants que events_enabled/services_enabled (052).
alter table tenants add column if not exists rental_delivery_enabled boolean not null default false;
alter table tenants add column if not exists rental_delivery_countries text[]; -- codes ISO2, ex. {'IT','FR'}

create table public.rental_delivery_zones (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  label                 text not null,
  postal_code_prefixes  text[],
  city                  text,
  country               text,
  fee_amount            numeric(10,2) not null check (fee_amount >= 0),
  note                  text,
  active                boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_rental_delivery_zones_tenant on public.rental_delivery_zones(tenant_id);

alter table public.rental_delivery_zones enable row level security;

-- Même pattern que rental_items (052) : GRANT explicites obligatoires, RLS
-- seule ne suffit pas. Lecture publique (aucune donnée sensible), écriture
-- réservée à service_role via les routes admin.
create policy "rental_delivery_zones_select_public"
  on public.rental_delivery_zones for select using (active = true);

grant select on public.rental_delivery_zones to anon, authenticated;
grant all on public.rental_delivery_zones to service_role;

comment on table public.rental_delivery_zones is
  'Zones de livraison location matériel — préfixe CP / ville / pays -> montant fixe. '
  'Matching : voir matchDeliveryZone() dans apps/storefront/src/lib/rental/matchDeliveryZone.ts.';
