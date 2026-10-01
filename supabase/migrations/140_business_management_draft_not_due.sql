-- MIGRATION 140: GESTION - una bozza non è un debito
--
-- Correzione della 139 emersa nella verifica funzionale su lepefy-test: le view
-- dei saldi contavano un acquisto `draft` come debito (outstanding = total).
-- Una bozza non è ancora un impegno verso il fornitore:
--   * supplier_purchase_financials.outstanding = 0 per draft e cancelled
--     (allocatable invariato: un acconto su una bozza resta possibile);
--   * supplier_balances esclude le bozze da totale acquistato, numero di
--     acquisti e data dell'ultimo acquisto.
-- Solo ridefinizione di view, stesse colonne e stessi tipi: create or replace
-- conserva privilegi (solo service_role) e opzione security_invoker.
-- Nessun dato modificato. Rollback: rieseguire la sezione 9 della 139.

begin;

create or replace view public.supplier_purchase_financials
with (security_invoker = true)
as
select
  p.id as purchase_id,
  p.tenant_id,
  p.supplier_id,
  p.status,
  p.currency,
  p.total,
  coalesce(a.paid_verified, 0)::numeric(12, 2) as paid_verified,
  coalesce(a.paid_unverified, 0)::numeric(12, 2) as paid_unverified,
  case when p.status in ('cancelled', 'draft') then 0
       else greatest(p.total - coalesce(a.paid_verified, 0), 0) end::numeric(12, 2) as outstanding,
  case when p.status = 'cancelled' then 0
       else greatest(p.total - coalesce(a.paid_verified, 0) - coalesce(a.paid_unverified, 0), 0) end::numeric(12, 2) as allocatable,
  coalesce(q.ordered_quantity, 0)::bigint as ordered_quantity,
  coalesce(q.received_quantity, 0)::bigint as received_quantity
from public.supplier_purchases p
left join lateral (
  select
    sum(al.amount) filter (where sp.status = 'verified') as paid_verified,
    sum(al.amount) filter (where sp.status = 'recorded') as paid_unverified
  from public.supplier_payment_allocations al
  join public.supplier_payments sp on sp.id = al.payment_id and sp.tenant_id = al.tenant_id
  where al.purchase_id = p.id and al.tenant_id = p.tenant_id and al.reversed_at is null
) a on true
left join lateral (
  select
    sum(i.ordered_quantity) as ordered_quantity,
    sum(coalesce(r.received, 0)) as received_quantity
  from public.supplier_purchase_items i
  left join lateral (
    select sum(ri.quantity) as received
    from public.supplier_receipt_items ri
    join public.supplier_receipts rc on rc.id = ri.receipt_id and rc.tenant_id = ri.tenant_id
    where ri.purchase_item_id = i.id and ri.tenant_id = i.tenant_id and rc.status = 'recorded'
  ) r on true
  where i.purchase_id = p.id and i.tenant_id = p.tenant_id
) q on true;

create or replace view public.supplier_balances
with (security_invoker = true)
as
select
  s.id as supplier_id,
  s.tenant_id,
  s.currency,
  coalesce(f.total_purchased, 0)::numeric(12, 2) as total_purchased,
  coalesce(f.paid_verified, 0)::numeric(12, 2) as paid_verified,
  coalesce(f.paid_unverified, 0)::numeric(12, 2) as paid_unverified,
  coalesce(f.outstanding, 0)::numeric(12, 2) as outstanding,
  coalesce(f.purchase_count, 0)::bigint as purchase_count,
  f.last_purchase_date,
  pay.last_payment_date,
  coalesce(pay.unallocated, 0)::numeric(12, 2) as unallocated_payments
from public.suppliers s
left join lateral (
  select
    sum(pf.total) filter (where pf.status not in ('cancelled', 'draft')) as total_purchased,
    sum(pf.paid_verified) as paid_verified,
    sum(pf.paid_unverified) as paid_unverified,
    sum(pf.outstanding) as outstanding,
    count(*) filter (where pf.status not in ('cancelled', 'draft')) as purchase_count,
    max(sp.order_date) filter (where pf.status not in ('cancelled', 'draft')) as last_purchase_date
  from public.supplier_purchase_financials pf
  join public.supplier_purchases sp on sp.id = pf.purchase_id
  where pf.supplier_id = s.id and pf.tenant_id = s.tenant_id
) f on true
left join lateral (
  select
    max(p.payment_date) filter (where p.status <> 'voided') as last_payment_date,
    sum(p.amount - coalesce(al.allocated, 0)) filter (where p.status <> 'voided') as unallocated
  from public.supplier_payments p
  left join lateral (
    select sum(x.amount) as allocated
    from public.supplier_payment_allocations x
    where x.payment_id = p.id and x.tenant_id = p.tenant_id and x.reversed_at is null
  ) al on true
  where p.supplier_id = s.id and p.tenant_id = s.tenant_id
) pay on true;

-- Difesa: i privilegi restano quelli della 139 (create or replace li conserva).
revoke all on table public.supplier_purchase_financials from public, anon, authenticated, service_role;
revoke all on table public.supplier_balances from public, anon, authenticated, service_role;
grant select on table public.supplier_purchase_financials to service_role;
grant select on table public.supplier_balances to service_role;

-- Verifica: supabase/verification/140_business_management_draft_not_due_verification.sql

commit;
