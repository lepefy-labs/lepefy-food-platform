-- ─── MIGRATION 065: PAYMENT FUNNEL LOGS ──────────────────────────────────────
-- Tabella di solo log per capire dove i clienti abbandonano i flussi di
-- pagamento Stripe (card/event/rental/shop). Deliberatamente condivisa tra
-- moduli, a differenza delle tabelle di business (event_reservation_requests,
-- rental_reservation_requests, ecc. — vedi 060/061): qui non c'è logica
-- applicativa sopra, solo eventi di telemetria, quindi condividere lo schema
-- è corretto invece di duplicarlo 4 volte.

create table if not exists public.payment_funnel_logs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  module        text not null check (module in ('shop', 'card', 'event', 'rental')),
  reference_id  uuid,
  event_type    text not null check (event_type in (
    'intent_created',
    'elements_mounted',
    'confirm_attempted',
    'requires_action',
    'confirm_error',
    'confirm_succeeded_client',
    'abandoned_payment_form'
  )),
  detail        jsonb,
  created_at    timestamptz not null default now()
);

create index idx_funnel_logs_tenant_module_date
  on public.payment_funnel_logs(tenant_id, module, created_at desc);

comment on table public.payment_funnel_logs is
  'Log di telemetria per il funnel di pagamento (shop/card/event/rental) — '
  'nessuna logica di business, solo diagnostica per capire dove i clienti '
  'abbandonano. Scrittura da client (fetch keepalive, non bloccante) e da '
  'alcune route server. Nessuna policy pubblica di lettura.';

alter table public.payment_funnel_logs enable row level security;

-- Scrittura pubblica necessaria: il log parte anche da clienti anonimi
-- (nessuna sessione) durante il checkout, prima che esista qualsiasi account.
-- Nessuna policy di SELECT pubblica — solo service_role legge.
create policy "public insert funnel logs"
  on public.payment_funnel_logs for insert
  to anon, authenticated
  with check (true);

grant insert on public.payment_funnel_logs to anon, authenticated;
grant select, insert on public.payment_funnel_logs to service_role;
