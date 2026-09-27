-- 135 — Internal recipients for service quote requests and equipment rental reservations.
--
-- Additive only, default off: no existing recipient starts receiving new alerts
-- until a tenant admin opts in from Paramètres → Notifications.
--   notify_service_inquiries   → new quote request (/webhook/send-email, service_inquiry_created)
--   notify_rental_reservations → rental reservation confirmed / delivery quote pending
-- Event capacity and rental stock conflicts reuse notify_order_stock_conflict.
-- Applying it twice is harmless (IF NOT EXISTS).

alter table public.tenant_notification_recipients
  add column if not exists notify_service_inquiries boolean not null default false;

alter table public.tenant_notification_recipients
  add column if not exists notify_rental_reservations boolean not null default false;
