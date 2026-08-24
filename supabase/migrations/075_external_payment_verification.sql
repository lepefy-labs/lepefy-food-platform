-- MIGRATION 075: durable external-payment verification state
-- External payment links (PayPal/Revolut/etc.) are not abandoned checkouts once
-- the provider handoff has been initiated. They remain pending until an admin
-- explicitly confirms or cancels them.

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_status_check;

alter table public.checkout_sessions
  add constraint checkout_sessions_status_check
  check (status in ('open', 'awaiting_verification', 'completed', 'cancelled', 'expired'));

alter table public.payment_funnel_logs
  drop constraint if exists payment_funnel_logs_event_type_check;

alter table public.payment_funnel_logs
  add constraint payment_funnel_logs_event_type_check
  check (event_type in (
    'intent_created',
    'elements_mounted',
    'confirm_attempted',
    'requires_action',
    'confirm_error',
    'confirm_succeeded_client',
    'abandoned_payment_form',
    'checkout_started',
    'checkout_reused',
    'checkout_resumed',
    'checkout_completed',
    'checkout_cancelled',
    'checkout_expired',
    'external_payment_awaiting_verification',
    'payment_failed_server'
  ));

-- A provider handoff makes an external checkout immutable as a purchase intent.
-- This BEFORE trigger also means the existing one-open-session-per-customer index
-- remains valid: awaiting_verification rows no longer consume the single open slot.
create or replace function public.mark_external_checkout_awaiting_verification()
returns trigger
language plpgsql
as $$
begin
  if new.payment_method = 'external_link'
     and new.status = 'open'
     and new.external_payment_link is not null then
    new.status := 'awaiting_verification';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mark_external_checkout_awaiting_verification on public.checkout_sessions;
create trigger trg_mark_external_checkout_awaiting_verification
before insert or update of payment_method, external_payment_link, status
on public.checkout_sessions
for each row execute function public.mark_external_checkout_awaiting_verification();

-- Recover historical external-link purchase intents that migration 074 marked
-- expired solely because the 24h checkout TTL elapsed. They are NOT marked paid;
-- they simply return to the admin verification queue.
update public.checkout_sessions
set
  status = 'awaiting_verification',
  updated_at = now(),
  last_activity_at = greatest(last_activity_at, created_at)
where payment_method = 'external_link'
  and external_payment_link is not null
  and order_id is null
  and status in ('open', 'expired');

create index if not exists idx_checkout_sessions_external_verification
  on public.checkout_sessions (tenant_id, created_at asc)
  where status = 'awaiting_verification' and payment_method = 'external_link';

comment on column public.checkout_sessions.expires_at is
  'TTL applies to recoverable open checkout sessions. External-link sessions move to awaiting_verification and remain until explicit admin resolution.';

create or replace function public.log_checkout_lifecycle_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.payment_funnel_logs(tenant_id, module, reference_id, event_type, detail)
    values (
      new.tenant_id,
      'shop',
      new.id,
      case new.status
        when 'completed' then 'checkout_completed'
        when 'cancelled' then 'checkout_cancelled'
        when 'expired' then 'checkout_expired'
        when 'awaiting_verification' then 'external_payment_awaiting_verification'
        else 'checkout_reused'
      end,
      jsonb_build_object('previous_status', old.status, 'order_id', new.order_id)
    );
  end if;
  return new;
end;
$$;

create or replace view public.checkout_funnel_30d as
select
  tenant_id,
  count(*) filter (where created_at >= now() - interval '30 days') as checkout_started,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'completed') as checkout_completed,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'open') as checkout_open,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'awaiting_verification') as checkout_awaiting_verification,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'expired') as checkout_expired,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'cancelled') as checkout_cancelled,
  count(*) filter (where created_at >= now() - interval '30 days' and resume_count > 0) as checkout_resumed,
  count(*) filter (where created_at >= now() - interval '30 days' and resume_count > 0 and status = 'completed') as checkout_recovered
from public.checkout_sessions
group by tenant_id;

grant select on public.checkout_funnel_30d to service_role;
