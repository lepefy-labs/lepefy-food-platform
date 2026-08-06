-- ─── MIGRATION 050: SHIPPING COUNTRY RULES ───────────────────────────────────
-- Livello di regole commerciali configurabili per paese, sopra il layer
-- esistente (Packlink PRO / flat_rate / pickup_only + shipping_vat_rates):
--   • gratuità sopra una soglia di carrello (per paese o globale '{*}')
--   • forfait fisso per paese (bypassa il calcolo Packlink per quel paese)
--   • sconto spedizione (percentuale o importo fisso) per paese o globale
-- Le tre leve possono coesistere sulla stessa riga.
--
-- countries = '{*}' → fallback per tutti i paesi non listati esplicitamente
-- (stesso pattern di shipping_vat_rates, vedi 003_shipping_packlink.sql).
--
-- Zero righe = comportamento identico a oggi, nessuna regola applicata.
-- Nessun seed promozionale per ChloeFood: Dalice configura dalla dashboard.

create table if not exists shipping_country_rules (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  countries             text[] not null,              -- es. '{IT}', '{FR,BE}', '{*}' = tutti
  free_shipping_above   numeric(10,2),                 -- soglia carrello, null = disattivato
  flat_rate_override    numeric(10,2),                 -- forfait fisso per questi paesi, null = usa provider normale
  discount_type         text check (discount_type in ('percentage','fixed')),
  discount_value        numeric(10,2),
  active                boolean not null default true,
  position              int not null default 0,
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique(tenant_id, countries)
);

comment on table shipping_country_rules is
  'Regole commerciali spedizione per paese: gratuità sopra soglia, forfait fisso, sconto. '
  'countries = {*} è il fallback per tutti i paesi non listati esplicitamente (stesso pattern di shipping_vat_rates).';

alter table shipping_country_rules enable row level security;

create policy "shipping_country_rules_select_public"
  on shipping_country_rules for select using (active = true);

-- GRANT espliciti obbligatori (RLS da sola non basta — vedi problemi ricorrenti passati)
grant select on shipping_country_rules to anon, authenticated;
grant select, insert, update, delete on shipping_country_rules to service_role, authenticated;

create trigger shipping_country_rules_updated_at before update on shipping_country_rules
  for each row execute function update_updated_at();
