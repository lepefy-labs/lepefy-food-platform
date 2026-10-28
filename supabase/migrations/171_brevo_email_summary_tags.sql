-- 171 — Fix brevo_email_message_summary.tags (migration 170).
--
-- 170 aggregated the tags with array_agg(text[])[1], which fails as soon as two
-- events of one message carry tag arrays of different lengths and is typed as
-- text, so the Food-scope filter `tags && …` could not run. max(text[]) returns
-- the first non-empty tag array as text[]. The view is dropped and recreated
-- (a column type cannot change through create or replace); nothing depends on it.
-- Applying it twice is harmless.

begin;

drop view if exists public.brevo_email_message_summary;

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
    max(e.tags) filter (where cardinality(e.tags) > 0) as tags,
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

commit;
