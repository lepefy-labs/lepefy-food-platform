-- Event external-payment requests: preserve cancelled requests instead of deleting them.
-- This is an additive lifecycle extension for manual PayPal/Revolut/etc. verification.

alter table public.event_reservation_requests
  drop constraint if exists event_reservation_requests_status_check;

alter table public.event_reservation_requests
  add constraint event_reservation_requests_status_check
  check (status in ('pending','confirmed','stock_conflict','cancelled'));

alter table public.event_reservation_requests
  add column if not exists cancelled_at timestamptz;

comment on column public.event_reservation_requests.cancelled_at is
  'Timestamp of an admin cancellation for an external-payment request. Cancellation does not refund the external provider payment.';
