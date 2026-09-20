-- ─── MIGRATION 120: INDEX INTERNE DES CODES POSTAUX (GeoNames) ───────────────
-- Table de référence globale (pas de tenant_id — données géographiques
-- publiques, non sensibles, partagées entre tenants), remplaçant la
-- dépendance à des API externes (Nominatim/Zippopotam/GeoNames en direct)
-- pour la recherche ville → codes postaux du Laboratoire.
--
-- Peuplée par `node scripts/import-geonames-postal-codes.mjs`, à partir des
-- exports statiques https://download.geonames.org/export/zip/{CC}.zip
-- (licence Creative Commons Attribution 4.0 — voir geonames.org/export/).
-- Aucun credential, aucun appel réseau au moment de la requête admin une
-- fois l'import fait : la recherche/résolution devient un simple SELECT.

create table shipping_postal_code_index (
  id                     uuid primary key default gen_random_uuid(),
  country                text not null,
  postal_code            text not null,
  place_name             text not null,
  place_name_normalized  text not null,
  admin_name1            text,
  admin_code1            text,
  admin_name2            text,
  admin_code2            text,
  latitude               numeric(9,6),
  longitude              numeric(9,6),
  imported_at            timestamptz not null default now(),
  unique(country, postal_code, place_name)
);

comment on table shipping_postal_code_index is
  'Index interne code postal <-> ville, importé statiquement depuis GeoNames (download.geonames.org/export/zip). '
  'Remplace les appels réseau live à Nominatim/Zippopotam/GeoNames pour la recherche de destinations de campagne.';

create index shipping_postal_code_index_country_place_idx
  on shipping_postal_code_index (country, place_name_normalized);
create index shipping_postal_code_index_country_postal_idx
  on shipping_postal_code_index (country, postal_code);

alter table shipping_postal_code_index enable row level security;
-- Pas de policy publique : consommé uniquement par nos routes admin via
-- service_role (même pattern que shipping_quote_observations).
grant select, insert, update, delete on shipping_postal_code_index to service_role;

-- Rollback :
-- BEGIN;
-- DROP TABLE shipping_postal_code_index;
-- COMMIT;
