-- ─── MIGRATION 069: FLAG is_test PER DATI GENERATI DAI TEST E2E ─────────────
-- Fase 0 dell'agente e2e — nessuna funzionalità di test in questa fase, solo
-- la colonna necessaria a distinguere ordini/prenotazioni reali da quelli
-- generati dai test automatici (che useranno un account Stripe separato,
-- dedicato solo ai test e2e). Vedi apps/storefront/src/lib/e2e/.

alter table public.orders add column if not exists is_test boolean not null default false;
alter table public.event_reservations add column if not exists is_test boolean not null default false;

create index if not exists idx_orders_is_test on public.orders(is_test) where is_test = true;
create index if not exists idx_event_reservations_is_test on public.event_reservations(is_test) where is_test = true;
