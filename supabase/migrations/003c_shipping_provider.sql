-- ─── MIGRATION 003c: SHIPPING PROVIDER PER TENANT ────────────────────────────
-- Aggiunge shipping_provider a tenants per supportare più sistemi di spedizione.
-- Ogni tenant può usare un provider diverso senza modifiche al codice.
--
-- Providers supportati:
--   packlink   → Packlink PRO API (default ChloeFood)
--   flat_rate  → tariffa fissa configurabile (es. 5€ sempre)
--   pickup_only→ solo ritiro in negozio, nessuna spedizione online
--
-- Aggiunge anche packlink_api_key per tenant multi-tenant completo:
-- ogni tenant con provider=packlink ha la sua chiave API separata.

alter table tenants
  add column if not exists shipping_provider text not null default 'packlink'
    check (shipping_provider in ('packlink', 'flat_rate', 'pickup_only'));

comment on column tenants.shipping_provider is
  'Sistema di spedizione del tenant. '
  'packlink = Packlink PRO API | flat_rate = tariffa fissa | pickup_only = solo ritiro';

-- Chiave API Packlink per tenant — separata dalla env var (multi-tenant completo).
-- Se null, il sistema usa PACKLINK_API_KEY dall'env (modalità single-tenant).
-- Per un secondo tenant con Packlink, inserire qui la sua chiave.
alter table tenants
  add column if not exists packlink_api_key text;

comment on column tenants.packlink_api_key is
  'API key Packlink PRO specifica per questo tenant. '
  'Se null, usa la variabile d''ambiente PACKLINK_API_KEY (fallback single-tenant).';

-- Tariffa fissa per tenant con shipping_provider = flat_rate
alter table tenants
  add column if not exists flat_rate_amount numeric(10,2);

comment on column tenants.flat_rate_amount is
  'Tariffa spedizione fissa in € per tenant con shipping_provider = flat_rate.';

-- Seed ChloeFood
update tenants
set shipping_provider = 'packlink'
where slug = 'chloefood';
