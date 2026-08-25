-- Persistent packing / expedition preparation metadata.
-- This remains separate from checkout shipping_details (pricing snapshot) and
-- from the order workflow status so packing progress can be audited safely.

alter table public.orders
  add column if not exists packing_started_at timestamptz,
  add column if not exists packing_completed_at timestamptz,
  add column if not exists packing_parcel_count integer,
  add column if not exists cold_chain_packing_checked_at timestamptz;

alter table public.orders
  drop constraint if exists orders_packing_parcel_count_check;

alter table public.orders
  add constraint orders_packing_parcel_count_check
  check (packing_parcel_count is null or packing_parcel_count > 0);

comment on column public.orders.packing_started_at is
  'Timestamp of the first persisted packing action for a delivery order.';
comment on column public.orders.packing_completed_at is
  'Timestamp when packing requirements were last fully satisfied.';
comment on column public.orders.packing_parcel_count is
  'Actual number of parcels prepared by the admin; independent from checkout quote estimates.';
comment on column public.orders.cold_chain_packing_checked_at is
  'Final packing validation for fresh/frozen products before shipment.';

-- Orders are managed through server-side service-role admin APIs. Keep the
-- grants explicit and aligned with the existing schema access pattern.
grant select, update on public.orders to service_role;
