-- 170 — Brevo transactional email events (Email Analytics, platform owner).
--
-- The Brevo webhook (POST /api/webhooks/brevo) appends one row per provider
-- event. Nothing is attributed at ingest time: the tenant, the notification
-- type, the subject and the business entity come from the delivery ledger
-- (notification_deliveries.provider_message_id) at READ time, so an event that
-- arrives before the ledger row is written (or out of order) is still
-- attributed correctly.
--   * one row per (message, recipient, event, provider timestamp): the dedupe
--     key `event_key` is unique, provider retries are no-ops;
--   * the recipient address is never stored: only an HMAC and a masked form;
--   * no subject, no full click URL (host only), reasons are truncated and
--     e-mail masked by the application;
--   * service_role only (RLS on, no policy, nothing granted to anon/authenticated);
--   * retention: purge_brevo_email_events() (180 days) is called opportunistically
--     by the webhook, no scheduler needed.
-- Additive; applying it twice is harmless.

begin;

create table if not exists public.brevo_email_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null check (char_length(event_key) = 64),
  message_id text not null check (char_length(message_id) between 3 and 300),
  recipient_hash text not null check (char_length(recipient_hash) = 64),
  recipient_masked text check (char_length(recipient_masked) <= 120),
  event text not null check (event in (
    'sent', 'delivered', 'first_open', 'open', 'proxy_open', 'click',
    'soft_bounce', 'hard_bounce', 'blocked', 'invalid', 'spam', 'deferred', 'error', 'unsubscribed'
  )),
  raw_event text check (char_length(raw_event) <= 40),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  template_id integer,
  reason text check (char_length(reason) <= 200),
  link_host text check (char_length(link_host) <= 120)
);

create unique index if not exists brevo_email_events_event_key_idx on public.brevo_email_events (event_key);
create index if not exists brevo_email_events_message_idx on public.brevo_email_events (message_id, recipient_hash);
create index if not exists brevo_email_events_occurred_idx on public.brevo_email_events (occurred_at desc);

alter table public.brevo_email_events enable row level security;
revoke all on table public.brevo_email_events from public, anon, authenticated;
grant select, insert, delete on table public.brevo_email_events to service_role;

-- The ledger is joined on the provider message id.
create index if not exists notification_deliveries_provider_message_idx
  on public.notification_deliveries (provider_message_id)
  where provider_message_id is not null;

-- One row per message × recipient, however many events arrived and in
-- whatever order (min/max aggregates, never a sequential state machine).
create or replace view public.brevo_email_message_summary as
with agg as (
  select
    e.message_id,
    e.recipient_hash,
    min(e.occurred_at) as first_event_at,
    min(e.occurred_at) filter (where e.event = 'sent') as sent_at,
    min(e.occurred_at) filter (where e.event = 'delivered') as delivered_at,
    min(e.occurred_at) filter (where e.event in ('first_open', 'open')) as first_open_at,
    min(e.occurred_at) filter (where e.event = 'proxy_open') as proxy_open_at,
    min(e.occurred_at) filter (where e.event = 'click') as click_at,
    count(*) filter (where e.event = 'click') as click_events,
    count(*) filter (where e.event in ('first_open', 'open')) as open_events,
    min(e.occurred_at) filter (where e.event in ('hard_bounce', 'soft_bounce', 'blocked', 'invalid', 'spam')) as failed_at,
    case
      when bool_or(e.event = 'hard_bounce') then 'hard_bounce'
      when bool_or(e.event = 'invalid') then 'invalid'
      when bool_or(e.event = 'blocked') then 'blocked'
      when bool_or(e.event = 'spam') then 'spam'
      when bool_or(e.event = 'soft_bounce') then 'soft_bounce'
    end as failure_event,
    bool_or(e.event = 'error') as has_error,
    bool_or(e.event = 'deferred') as has_deferred,
    max(e.recipient_masked) as recipient_masked,
    (array_agg(e.tags) filter (where cardinality(e.tags) > 0))[1] as tags,
    max(e.template_id) as template_id,
    (array_agg(e.reason order by e.occurred_at desc) filter (where e.reason is not null))[1] as reason
  from public.brevo_email_events e
  group by e.message_id, e.recipient_hash
)
select
  a.*,
  d.id as delivery_id,
  d.tenant_id,
  d.notification_type,
  d.subject,
  ev.entity_type,
  ev.entity_id
from agg a
left join lateral (
  select nd.id, nd.tenant_id, nd.notification_type, nd.subject, nd.event_id
  from public.notification_deliveries nd
  where nd.provider_message_id = a.message_id and nd.channel = 'email'
  order by nd.created_at desc
  limit 1
) d on true
left join public.tenant_notification_events ev on ev.id = d.event_id;

revoke all on public.brevo_email_message_summary from public, anon, authenticated;
grant select on public.brevo_email_message_summary to service_role;

-- Retention (180 days). Returns the number of rows removed.
create or replace function public.purge_brevo_email_events(p_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.brevo_email_events
   where occurred_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics removed = row_count;
  return removed;
end
$$;

revoke all on function public.purge_brevo_email_events(integer) from public, anon, authenticated;
grant execute on function public.purge_brevo_email_events(integer) to service_role;

commit;
