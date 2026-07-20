-- ─── MIGRATION 030: PAYMENT METHODS (digital card) ──────────────────────────
-- Metodi di pagamento configurabili per tenant, mostrati in /card nella
-- sezione "Comment payer" — separati da tenants.bank_iban/bic (che sono per
-- il billing SaaS Lepefy → tenant, non per i pagamenti cliente → negozio).

create table if not exists public.tenant_payment_methods (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  method      text not null check (method in (
                'satispay', 'bank_transfer', 'cash', 'paypal', 'other'
              )),
  label       text,           -- etichetta visualizzata (es. "Virement ChloeFood")
  value       text,           -- IBAN / link PayPal / link Satispay / testo libero — null per cash
  extra       jsonb,          -- es. {"beneficiary": "...", "bic": "..."} per bank_transfer
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.tenant_payment_methods is
  'Metodi di pagamento cliente-facing per tenant, mostrati nella digital card (/card). '
  'Nuovi metodi si aggiungono estendendo la CHECK constraint e il registro '
  'PAYMENT_METHOD_REGISTRY in packages/types — mai nel componente del tenant.';

alter table public.tenant_payment_methods enable row level security;

create policy "tenant_payment_methods_select_public"
  on public.tenant_payment_methods for select
  using (active = true);

grant usage on schema public to anon, authenticated;
grant select on public.tenant_payment_methods to anon, authenticated;

-- ─── Seed placeholder ChloeFood — DA SOSTITUIRE con dati reali via admin ────
insert into public.tenant_payment_methods (tenant_id, method, label, value, extra, sort_order, active)
select
  t.id,
  'bank_transfer',
  '⚠️ PLACEHOLDER — Virement bancaire',
  'IT00 X000 0000 0000 0000 0000 000',
  '{"beneficiary": "⚠️ À REMPLACER", "bic": "⚠️ À REMPLACER"}'::jsonb,
  1,
  true
from public.tenants t where t.slug = 'chloefood';

insert into public.tenant_payment_methods (tenant_id, method, label, value, extra, sort_order, active)
select t.id, 'paypal', '⚠️ PLACEHOLDER — PayPal', 'https://paypal.me/CHANGEME', null, 2, true
from public.tenants t where t.slug = 'chloefood';

insert into public.tenant_payment_methods (tenant_id, method, label, value, extra, sort_order, active)
select t.id, 'cash', null, null, null, 3, true
from public.tenants t where t.slug = 'chloefood';
