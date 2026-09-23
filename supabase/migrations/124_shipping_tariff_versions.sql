-- 124_shipping_tariff_versions.sql
--
-- Forfait di spedizione V1F — foundation + shadow mode.
--
-- 1. tenants.shipping_pricing_mode : separa la MODALITÀ DI PRICING dal provider
--    logistico (tenants.shipping_provider, invariato — 'flat_rate' resta il
--    forfait unico esistente e continua a funzionare).
--      provider_cost (default) → comportamento attuale, nessun calcolo shadow;
--      shadow                  → il cliente paga il preventivo attuale, il
--                                forfait è calcolato solo per analisi;
--      tariff                  → riservato a una futura attivazione esplicita:
--                                in V1F il codice lo tratta come provider_cost.
--    Default per tutti i tenant esistenti = provider_cost → zero cambiamenti.
--
-- 2. shipping_tariff_versions : snapshot IMMUTABILI di una tariffa, copiate da
--    una bozza (shipping_tariff_drafts resta modificabile e non è mai letta dal
--    checkout). Importi in centesimi, pesi in grammi.
--      validated → snapshot creato, non selezionato;
--      shadow    → versione usata dalla raccolta shadow (al più una per
--                  tenant e paese);
--      retired   → non più selezionata (resta consultabile e riselezionabile);
--      active    → riservato alla futura tariffazione commerciale; nessun
--                  codice V1F lo imposta né lo legge.
--
-- Migration additiva, senza backfill. Rollback in fondo al file.

-- ─── 1. Modalità di pricing del tenant ────────────────────────────────────
alter table tenants
  add column shipping_pricing_mode text not null default 'provider_cost'
    check (shipping_pricing_mode in ('provider_cost', 'shadow', 'tariff'));

comment on column tenants.shipping_pricing_mode is
  'provider_cost (default, prezzo = provider) | shadow (prezzo = provider, forfait calcolato solo per analisi) | '
  'tariff (riservato, non supportato in V1F: trattato come provider_cost). Indipendente da shipping_provider.';

-- ─── 2. Versioni tariffarie immutabili ────────────────────────────────────
create table shipping_tariff_versions (
  id                             uuid primary key default gen_random_uuid(),
  tenant_id                      uuid not null references tenants(id) on delete cascade,
  country                        text not null check (country ~ '^[A-Z]{2}$'),
  currency                       text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  version                        int  not null check (version > 0),
  status                         text not null default 'validated'
                                   check (status in ('validated', 'shadow', 'retired', 'active')),
  name                           text not null,
  -- [{ "min_g_exclusive": int, "max_g_inclusive": int|null, "price_cents": int }]
  bands                          jsonb not null check (jsonb_typeof(bands) = 'array' and jsonb_array_length(bands) > 0),
  -- [{ "zone_code": text, "amount_cents": int, "mode": "per_parcel"|"per_order" }]
  zone_surcharges                jsonb not null default '[]' check (jsonb_typeof(zone_surcharges) = 'array'),
  -- zone non consegnabili (es. IT_EXTRA_CUSTOMS)
  non_deliverable_zones          text[] not null default '{}',
  max_parcel_weight_g            int  not null check (max_parcel_weight_g > 0),
  block_weight_g                 int  check (block_weight_g is null or block_weight_g > 0),
  block_price_cents              int  check (block_price_cents is null or block_price_cents >= 0),
  logistics_verified_max_weight_g int check (logistics_verified_max_weight_g is null or logistics_verified_max_weight_g > 0),
  prices_include_vat             boolean not null default true,
  source_draft_id                uuid references shipping_tariff_drafts(id) on delete set null,
  notes                          text,
  created_by                     uuid,
  created_at                     timestamptz not null default now(),
  selected_at                    timestamptz,
  retired_at                     timestamptz,
  updated_at                     timestamptz not null default now(),
  unique (tenant_id, country, version),
  check ((block_weight_g is null) = (block_price_cents is null))
);

comment on table shipping_tariff_versions is
  'Snapshot immutabili di tariffe forfait (fasce, blocchi, maggiorazioni di zona). V1F: usate solo dalla raccolta shadow; '
  'il checkout non addebita mai questi prezzi. Una correzione crea una nuova versione.';

create unique index shipping_tariff_versions_one_shadow
  on shipping_tariff_versions (tenant_id, country) where status = 'shadow';

create unique index shipping_tariff_versions_one_active
  on shipping_tariff_versions (tenant_id, country) where status = 'active';

create index shipping_tariff_versions_tenant_idx
  on shipping_tariff_versions (tenant_id, country, version desc);

-- Immutabilità: i parametri economici e l'identità della versione non cambiano
-- mai dopo l'inserimento. Solo stato, date di selezione/ritiro e note.
create or replace function shipping_tariff_versions_immutable()
returns trigger language plpgsql as $$
begin
  if new.tenant_id              is distinct from old.tenant_id
  or new.country                is distinct from old.country
  or new.currency               is distinct from old.currency
  or new.version                is distinct from old.version
  or new.name                   is distinct from old.name
  or new.bands                  is distinct from old.bands
  or new.zone_surcharges        is distinct from old.zone_surcharges
  or new.non_deliverable_zones  is distinct from old.non_deliverable_zones
  or new.max_parcel_weight_g    is distinct from old.max_parcel_weight_g
  or new.block_weight_g         is distinct from old.block_weight_g
  or new.block_price_cents      is distinct from old.block_price_cents
  or new.logistics_verified_max_weight_g is distinct from old.logistics_verified_max_weight_g
  or new.prices_include_vat     is distinct from old.prices_include_vat
  or new.created_by             is distinct from old.created_by
  or new.created_at             is distinct from old.created_at
  then
    raise exception 'shipping_tariff_versions % is immutable: create a new version instead', old.id
      using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger shipping_tariff_versions_immutable
  before update on shipping_tariff_versions
  for each row execute function shipping_tariff_versions_immutable();

alter table shipping_tariff_versions enable row level security;
-- Nessuna policy pubblica (configurazione commerciale interna). Nessun DELETE:
-- una versione registrata sugli ordini deve restare spiegabile.
grant select, insert, update on shipping_tariff_versions to service_role;

-- ─── 3. Selezione atomica della versione shadow ───────────────────────────
-- Ritira la versione shadow corrente (stesso tenant e paese) e seleziona la
-- versione richiesta in una sola transazione. Non può mai produrre 'active'.
create or replace function select_shipping_tariff_shadow_version(
  p_tenant_id  uuid,
  p_version_id uuid
) returns shipping_tariff_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  target shipping_tariff_versions;
begin
  select * into target
    from shipping_tariff_versions
   where id = p_version_id and tenant_id = p_tenant_id
   for update;

  if not found then
    raise exception 'tariff_version_not_found' using errcode = 'P0002';
  end if;
  if target.status = 'active' then
    raise exception 'tariff_version_is_active' using errcode = 'P0001';
  end if;
  if target.status = 'shadow' then
    return target;
  end if;

  update shipping_tariff_versions
     set status = 'retired', retired_at = now()
   where tenant_id = p_tenant_id and country = target.country and status = 'shadow';

  update shipping_tariff_versions
     set status = 'shadow', selected_at = now(), retired_at = null
   where id = p_version_id
  returning * into target;

  return target;
end;
$$;

revoke all on function select_shipping_tariff_shadow_version(uuid, uuid) from public, anon, authenticated;
grant execute on function select_shipping_tariff_shadow_version(uuid, uuid) to service_role;

-- Rollback (nessun dato esistente modificato ; i shadow_tariff già scritti in
-- orders.shipping_details restano come JSON inerte) :
-- BEGIN;
-- UPDATE tenants SET shipping_pricing_mode = 'provider_cost';   -- stop immediato della raccolta
-- DROP FUNCTION select_shipping_tariff_shadow_version(uuid, uuid);
-- DROP TABLE shipping_tariff_versions;
-- DROP FUNCTION shipping_tariff_versions_immutable();
-- ALTER TABLE tenants DROP COLUMN shipping_pricing_mode;
-- COMMIT;
