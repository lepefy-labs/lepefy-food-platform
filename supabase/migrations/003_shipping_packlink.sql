-- ─── MIGRATION 003: PACKLINK SHIPPING ────────────────────────────────────────
-- Configurazione spedizioni ChloeFood — Giugno 2026
--
-- Decisioni cliente:
--   • Tutti i prodotti trattati allo stesso modo (nessuna differenziazione
--     per tipo conservazione nel calcolo spedizione)
--   • Corriere scelto in tempo reale da Packlink PRO (API)
--   • Surplus imballaggio: 3,00 € per pacco — configurabile in DB
--   • IVA sul prezzo Packlink: configurabile per paese in DB
--   • Spedizione gratuita: non configurata al lancio

-- ─── 1. STORAGE TYPE — colonna opzionale per uso admin/futuro ────────────────
alter table products
  add column if not exists storage_type text not null default 'dry'
    check (storage_type in ('dry', 'fresh', 'frozen'));

comment on column products.storage_type is
  'Tipo conservazione — solo uso amministrativo e report. '
  'Non influenza il calcolo spedizione: tutti i prodotti trattati allo '
  'stesso modo tramite Packlink PRO.';

-- ─── 2. PACKAGING SURCHARGE ──────────────────────────────────────────────────
-- Surplus imballaggio completamente configurabile:
--   surcharge_mode = 'per_parcel' → 3€ × num_pacchi
--   surcharge_mode = 'per_order'  → 3€ fisso indipendentemente dai pacchi

create table if not exists packaging_surcharges (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  surcharge_amount    numeric(10,2) not null default 3.00,
  surcharge_mode      text not null default 'per_parcel'
                        check (surcharge_mode in ('per_parcel', 'per_order')),
  max_pack_kg         numeric(6,2)  not null default 15.00,
  active              boolean not null default true,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique(tenant_id)
);

comment on column packaging_surcharges.surcharge_amount is
  'Costo imballaggio in €. Applicato per pacco o per ordine secondo surcharge_mode.';

comment on column packaging_surcharges.surcharge_mode is
  'per_parcel = surcharge_amount × num_pacchi | per_order = surcharge_amount fisso';

comment on column packaging_surcharges.max_pack_kg is
  'Peso massimo per pacco fisico in kg. Usato per calcolare num_pacchi = ceil(peso_g / (max_pack_kg × 1000)).';

alter table packaging_surcharges enable row level security;

create policy "packaging_surcharges_select_public"
  on packaging_surcharges for select using (active = true);

-- Seed ChloeFood — 3€ per pacco, confermato dalla cliente (Giugno 2026)
insert into packaging_surcharges (tenant_id, surcharge_amount, surcharge_mode, max_pack_kg)
values (
  (select id from tenants where slug = 'chloefood'),
  3.00,
  'per_parcel',
  15.00
)
on conflict (tenant_id) do update
  set surcharge_amount = excluded.surcharge_amount,
      surcharge_mode   = excluded.surcharge_mode,
      max_pack_kg      = excluded.max_pack_kg,
      updated_at       = now();

-- ─── 3. VAT RATES PER DESTINATION ────────────────────────────────────────────
-- IVA applicata al prezzo Packlink PRO per paese di destinazione.
-- Se Packlink include già l'IVA → impostare vat_rate = 0.00.
-- countries = '{*}' → fallback per tutti i paesi non listati esplicitamente.

create table if not exists shipping_vat_rates (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  countries   text[] not null,
  vat_rate    numeric(5,4) not null default 0.22,
  active      boolean not null default true,
  note        text,
  created_at  timestamptz not null default now(),
  unique(tenant_id, countries)
);

comment on table shipping_vat_rates is
  'Aliquota IVA sul prezzo Packlink per paese. '
  'vat_rate = 0.22 → 22% | 0.00 → esente. '
  'countries = ''{*}'' è il fallback per paesi non listati.';

alter table shipping_vat_rates enable row level security;

create policy "shipping_vat_rates_select_public"
  on shipping_vat_rates for select using (active = true);

-- Seed ChloeFood
do $$
declare tid uuid := (select id from tenants where slug = 'chloefood');
begin
  insert into shipping_vat_rates (tenant_id, countries, vat_rate, note) values
    (tid, '{IT}',       0.22, 'IVA ordinaria IT 22% — verificare se Packlink include già IVA'),
    (tid, '{FR,BE,DE}', 0.22, 'UE — precauzionale, da confermare con Packlink PRO'),
    (tid, '{CH}',       0.00, 'Extra-UE Svizzera — tipicamente esente IVA italiana'),
    (tid, '{*}',        0.22, 'Fallback — tutti gli altri paesi')
  on conflict (tenant_id, countries) do update
    set vat_rate = excluded.vat_rate,
        note     = excluded.note;
end $$;
