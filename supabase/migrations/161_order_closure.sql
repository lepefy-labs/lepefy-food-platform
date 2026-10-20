-- MIGRATION 161: CLÔTURE DES COMMANDES (annulation motivée, commande traitée hors plateforme)
--
-- Additive, réversible, sans backfill. Le statut reste `cancelled` pour toute
-- clôture : aucune nouvelle transition dans la machine d'état. La nature de la
-- clôture est portée par `closure_type` :
--   - `cancelled`          annulation commerciale (vente perdue) ;
--   - `handled_externally` commande finalisée directement avec la boutique
--                          (téléphone, WhatsApp, magasin) : pas une vente perdue,
--                          ni un paiement confirmé, ni une livraison.
-- Les commandes déjà annulées gardent `closure_type` null = annulation historique
-- (comptée comme annulation commerciale).
--
-- Miroir TS : lib/orders/closure/closureRules.ts.
--
-- Rollback :
--   drop trigger if exists audit_order_closure_update on public.orders;
--   drop function if exists public.audit_order_closure_trigger();
--   delete from public.audit_event_types where key = 'orders.order.closed';
--   (vues : réexécuter supabase/migrations/118_admin_order_dashboard_stats.sql après avoir supprimé les deux vues)
--   alter table public.orders drop constraint if exists orders_closure_check,
--     drop column if exists closure_type, drop column if exists closure_reason, drop column if exists closure_note,
--     drop column if exists closure_notification, drop column if exists closure_message,
--     drop column if exists closed_at, drop column if exists closed_by;
--
-- Rejouable sans effet de bord.

begin;

-- ─── 1. Colonnes ─────────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists closure_type text,
  add column if not exists closure_reason text,
  add column if not exists closure_note text,
  add column if not exists closure_notification text,
  add column if not exists closure_message text,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.admin_users(id) on delete set null;

alter table public.orders drop constraint if exists orders_closure_check;
alter table public.orders add constraint orders_closure_check check (
  (closure_type is null and closure_reason is null and closure_notification is null and closure_message is null and closed_at is null)
  or (
    status = 'cancelled'
    and closure_type in ('cancelled', 'handled_externally')
    and closure_reason in ('handled_externally', 'duplicate', 'customer_request', 'product_unavailable', 'other')
    and (closure_type = 'handled_externally') = (closure_reason = 'handled_externally')
    and closure_notification in ('none', 'standard', 'custom')
    and (closure_notification = 'custom') = (closure_message is not null)
    and (closure_message is null or char_length(closure_message) between 20 and 1000)
    and (closure_note is null or char_length(closure_note) <= 500)
    and (closure_reason <> 'other' or char_length(coalesce(closure_note, '')) >= 3)
    and not (closure_type = 'handled_externally' and closure_notification = 'standard')
    and closed_at is not null
  )
);

comment on column public.orders.closure_type is
  'Nature of the closure of a cancelled order: cancelled (commercial cancellation, lost sale) or handled_externally (finished directly with the shop; neither a lost sale nor a confirmed payment or delivery). Null on a cancelled order = historical cancellation (before 161).';
comment on column public.orders.closure_notification is
  'Customer communication chosen at closure: none, standard (order-cancelled email) or custom (closure_message, email). Internal notifications are separate.';
comment on column public.orders.closure_message is 'Custom message sent to the customer (closure_notification = custom). Never copied to the audit log.';
comment on column public.orders.closure_note is 'Internal note of the closure (staff only).';

create index if not exists orders_closure_type_idx on public.orders (tenant_id, closure_type) where closure_type is not null;

-- ─── 2. Journal d'activité ───────────────────────────────────────────────────
insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
  ('orders.order.closed', 'orders', 'activity', 'notice', 'business')
on conflict (key) do nothing;

create or replace function public.audit_order_closure_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform public.audit_emit(false, new.tenant_id, 'orders.order.closed', 'order', new.id::text, '#' || upper(left(new.id::text, 8)), '[]'::jsonb,
      jsonb_build_object('closure_type', new.closure_type, 'reason', new.closure_reason,
        'notification', new.closure_notification, 'has_note', new.closure_note is not null,
        'previous_status', old.status, 'payment_status', new.payment_status));
  exception when others then
    perform public.audit_note_failure(new.tenant_id, 'orders.order.closed', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

revoke all on function public.audit_order_closure_trigger() from public, anon, authenticated, service_role;

drop trigger if exists audit_order_closure_update on public.orders;
create trigger audit_order_closure_update after update on public.orders
  for each row
  when (old.closed_at is null and new.closed_at is not null)
  execute function public.audit_order_closure_trigger();

-- ─── 3. Statistiques : annulations commerciales vs clôtures hors plateforme ──
-- Mêmes colonnes que la 118, `closure_type` ajoutée en fin de vue.
create or replace view public.order_operational_status as
with item_stats as (
  select
    order_id,
    count(*) as item_count,
    bool_and(picked_at is not null) as all_picked,
    bool_or(storage_type in ('fresh', 'frozen')) as has_cold_chain,
    bool_and(
      case when storage_type in ('fresh', 'frozen') then cold_chain_checked_at is not null else true end
    ) as all_cold_chain_checked
  from public.order_items
  group by order_id
)
select
  o.id,
  o.tenant_id,
  o.status,
  o.fulfillment_type,
  o.payment_status,
  o.created_at,
  o.total,
  o.tracking_code,
  o.packing_completed_at,
  o.cold_chain_packing_checked_at,
  coalesce(s.has_cold_chain, false) as has_cold_chain,
  (coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true))
    as picking_complete,
  (o.status = 'preparing'
    and not (coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)))
    as is_picking_incomplete,
  (o.status = 'preparing' and o.fulfillment_type = 'delivery'
    and coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)
    and o.packing_completed_at is null)
    as is_packing_pending,
  (o.status = 'preparing' and o.fulfillment_type = 'delivery'
    and coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)
    and o.packing_completed_at is not null and o.tracking_code is null)
    as is_tracking_missing,
  (o.status in ('new', 'preparing', 'ready_for_pickup')
    and coalesce(s.has_cold_chain, false)
    and (
      not coalesce(s.all_cold_chain_checked, true)
      or (o.fulfillment_type = 'delivery' and o.status = 'preparing'
          and coalesce(s.item_count, 0) > 0 and coalesce(s.all_picked, false) and coalesce(s.all_cold_chain_checked, true)
          and o.cold_chain_packing_checked_at is null)
    ))
    as has_cold_chain_action,
  (o.status not in ('delivered', 'cancelled') and o.created_at <= now() - interval '24 hours')
    as is_aged,
  o.closure_type
from public.orders o
left join item_stats s on s.order_id = o.id;

grant select on public.order_operational_status to service_role;

create or replace view public.admin_order_dashboard_stats as
select
  tenant_id,
  count(*) as total_count,
  count(*) filter (where status = 'new') as new_count,
  count(*) filter (where status = 'preparing') as preparing_count,
  count(*) filter (where status = 'ready_for_pickup') as ready_for_pickup_count,
  count(*) filter (where status = 'shipped') as shipped_count,
  count(*) filter (where status = 'delivered') as delivered_count,
  -- Commercial cancellations only: an order handled outside the platform is not a lost sale.
  count(*) filter (where status = 'cancelled' and coalesce(closure_type, 'cancelled') = 'cancelled') as cancelled_count,
  count(*) filter (where status = 'preparing' and fulfillment_type = 'delivery') as to_ship_count,
  count(*) filter (where payment_status = 'pending') as pending_payment_count,
  count(*) filter (where is_aged) as aged_count,
  count(*) filter (where is_picking_incomplete) as picking_incomplete_count,
  count(*) filter (where is_packing_pending) as packing_pending_count,
  count(*) filter (where is_tracking_missing) as tracking_missing_count,
  count(*) filter (where has_cold_chain_action) as cold_chain_action_count,
  coalesce(
    sum(total) filter (
      where payment_status = 'paid'
        and status <> 'cancelled'
        and date_trunc('month', created_at) = date_trunc('month', now())
    ), 0
  ) as this_month_revenue,
  count(*) filter (where status = 'cancelled' and closure_type = 'handled_externally') as external_closure_count
from public.order_operational_status
group by tenant_id;

grant select on public.admin_order_dashboard_stats to service_role;

commit;
