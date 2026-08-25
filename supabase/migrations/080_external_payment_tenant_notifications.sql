-- MIGRATION 080: internal tenant notification for external payments awaiting verification
-- Additive and reversible. Existing configured recipients opt in by default because
-- an external payment awaiting verification is an operational action item, not marketing.

alter table public.tenant_notification_recipients
  add column if not exists notify_external_payment_pending boolean not null default true;

comment on column public.tenant_notification_recipients.notify_external_payment_pending is
  'Receive internal tenant alert when a shop external-link checkout enters awaiting_verification.';

-- Atomic idempotency claim for the application -> n8n tenant alert. The application
-- sets this only while the checkout is unresolved; on transport/configuration failure
-- it releases the claim so a later retry can attempt delivery again.
alter table public.checkout_sessions
  add column if not exists external_payment_tenant_notified_at timestamptz;

comment on column public.checkout_sessions.external_payment_tenant_notified_at is
  'Timestamp when n8n accepted the internal tenant alert for an external payment awaiting verification; also used as an atomic send claim.';
