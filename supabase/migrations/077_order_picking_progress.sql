-- Persistent order picking progress
-- Keeps picking separate from the existing order status workflow.
-- No stock, payment or order-total behavior is changed by this migration.

alter table public.orders
  add column if not exists picking_started_at timestamptz,
  add column if not exists picking_completed_at timestamptz;

alter table public.order_items
  add column if not exists picked_at timestamptz,
  add column if not exists cold_chain_checked_at timestamptz;

comment on column public.orders.picking_started_at is
  'Timestamp when warehouse preparation started. Separate from the order status lifecycle.';

comment on column public.orders.picking_completed_at is
  'Timestamp when all order lines were picked and all fresh/frozen lines passed cold-chain validation.';

comment on column public.order_items.picked_at is
  'Timestamp when the full ordered quantity for this line was picked.';

comment on column public.order_items.cold_chain_checked_at is
  'Timestamp when handling/temperature requirements were confirmed for fresh/frozen lines. Null for dry items.';

create index if not exists idx_order_items_order_picking
  on public.order_items (order_id, picked_at, cold_chain_checked_at);

create index if not exists idx_orders_picking_in_progress
  on public.orders (tenant_id, picking_started_at, picking_completed_at)
  where status = 'preparing';

-- Admin APIs use the service role. Keep direct browser roles away from these
-- operational fields while ensuring the service role has explicit privileges.
grant select, update on public.orders to service_role;
grant select, update on public.order_items to service_role;
