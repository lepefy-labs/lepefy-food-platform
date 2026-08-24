-- MIGRATION 074: checkout recovery lifecycle + conversion analytics
-- Additive evolution of checkout_sessions. Orders are still created only after
-- confirmed payment; checkout_sessions become the durable purchase-intent trail.

alter table public.checkout_sessions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists order_id uuid references public.orders(id) on delete set null,
  add column if not exists resume_count integer not null default 0,
  add column if not exists last_resumed_at timestamptz;

update public.checkout_sessions
set
  updated_at = coalesce(updated_at, created_at),
  last_activity_at = coalesce(last_activity_at, created_at),
  expires_at = coalesce(expires_at, created_at + interval '24 hours')
where expires_at is null;

alter table public.checkout_sessions
  alter column expires_at set default (now() + interval '24 hours'),
  alter column expires_at set not null;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_status_check;

alter table public.checkout_sessions
  add constraint checkout_sessions_status_check
  check (status in ('open', 'completed', 'cancelled', 'expired'));

update public.checkout_sessions
set status = 'expired', updated_at = now()
where status = 'open' and expires_at <= now();

-- Historical duplicates are retained for analytics but only the newest remains
-- recoverable. This allows a safe partial unique index for future writes.
with ranked as (
  select id,
         row_number() over (
           partition by tenant_id, customer_id
           order by last_activity_at desc, created_at desc, id desc
         ) as rn
  from public.checkout_sessions
  where customer_id is not null and status = 'open'
)
update public.checkout_sessions cs
set status = 'expired', updated_at = now()
from ranked r
where cs.id = r.id and r.rn > 1;

create unique index if not exists checkout_sessions_one_open_per_customer
  on public.checkout_sessions (tenant_id, customer_id)
  where customer_id is not null and status = 'open';

create index if not exists idx_checkout_sessions_lifecycle
  on public.checkout_sessions (tenant_id, status, created_at desc);

create index if not exists idx_checkout_sessions_expiry
  on public.checkout_sessions (status, expires_at)
  where status = 'open';

create index if not exists idx_checkout_sessions_order_id
  on public.checkout_sessions (order_id)
  where order_id is not null;

comment on column public.checkout_sessions.expires_at is
  'Open checkout validity boundary. Default 24h and refreshed on meaningful customer activity.';
comment on column public.checkout_sessions.order_id is
  'Order created from this checkout after confirmed payment; preserves checkout -> order lineage.';
comment on column public.checkout_sessions.resume_count is
  'Number of explicit customer resume visits to the checkout recovery flow.';

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
    'payment_failed_server'
  ));

-- Lifecycle transitions are logged centrally, including transitions caused by
-- lazy expiration in application code.
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
        else 'checkout_reused'
      end,
      jsonb_build_object('previous_status', old.status, 'order_id', new.order_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_checkout_lifecycle_log on public.checkout_sessions;
create trigger trg_checkout_lifecycle_log
after update of status on public.checkout_sessions
for each row execute function public.log_checkout_lifecycle_transition();

-- Stripe storefront order creation still lives in the webhook. Link the
-- completed purchase intent as soon as that order is inserted, before legacy
-- cleanup code gets a chance to remove the checkout row.
create or replace function public.link_checkout_to_stripe_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stripe_payment_intent_id is not null then
    update public.checkout_sessions
    set
      status = 'completed',
      order_id = new.id,
      completed_at = coalesce(completed_at, now()),
      last_activity_at = now(),
      updated_at = now()
    where stripe_payment_intent_id = new.stripe_payment_intent_id
      and status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_checkout_to_stripe_order on public.orders;
create trigger trg_link_checkout_to_stripe_order
after insert on public.orders
for each row execute function public.link_checkout_to_stripe_order();

-- Compatibility guard: old webhook/helper revisions used DELETE after order
-- creation. Once a checkout is completed it becomes an audit record and may
-- not be physically deleted by those legacy cleanup statements.
create or replace function public.protect_completed_checkout_from_delete()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'completed' or old.order_id is not null then
    return null;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_completed_checkout_delete on public.checkout_sessions;
create trigger trg_protect_completed_checkout_delete
before delete on public.checkout_sessions
for each row execute function public.protect_completed_checkout_from_delete();

create or replace view public.checkout_funnel_30d as
select
  tenant_id,
  count(*) filter (where created_at >= now() - interval '30 days') as checkout_started,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'completed') as checkout_completed,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'open') as checkout_open,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'expired') as checkout_expired,
  count(*) filter (where created_at >= now() - interval '30 days' and status = 'cancelled') as checkout_cancelled,
  count(*) filter (where created_at >= now() - interval '30 days' and resume_count > 0) as checkout_resumed,
  count(*) filter (where created_at >= now() - interval '30 days' and resume_count > 0 and status = 'completed') as checkout_recovered
from public.checkout_sessions
group by tenant_id;

grant select on public.checkout_funnel_30d to service_role;
