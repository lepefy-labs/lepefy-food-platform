-- Automatic delivery of the three operational event reservation reports.
-- Existing future events are included immediately. Past events are never sent
-- retroactively by the application/dispatcher.

alter table public.events
  add column if not exists booking_close_reports_fallback_hours integer not null default 2,
  add column if not exists booking_close_reports_dispatch_token uuid not null default gen_random_uuid(),
  add column if not exists booking_close_reports_scheduled_for timestamptz,
  add column if not exists booking_close_reports_status text not null default 'pending',
  add column if not exists booking_close_reports_claimed_at timestamptz,
  add column if not exists booking_close_reports_sent_at timestamptz,
  add column if not exists booking_close_reports_last_error text;

do $$ begin
  alter table public.events
    add constraint events_booking_close_reports_fallback_hours_check
    check (booking_close_reports_fallback_hours between 1 and 168);
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.events
    add constraint events_booking_close_reports_status_check
    check (booking_close_reports_status in ('pending', 'sending', 'sent', 'error'));
exception when duplicate_object then null;
end $$;

alter table public.tenant_notification_recipients
  add column if not exists notify_event_booking_closed_reports boolean not null default true;

create or replace function public.set_event_booking_close_reports_schedule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  schedule_changed boolean;
begin
  new.booking_close_reports_scheduled_for := coalesce(
    new.booking_closes_at,
    new.date_start - make_interval(hours => new.booking_close_reports_fallback_hours)
  );

  if tg_op = 'INSERT' then
    schedule_changed := true;
  else
    schedule_changed := old.date_start is distinct from new.date_start
      or old.booking_closes_at is distinct from new.booking_closes_at
      or old.booking_close_reports_fallback_hours is distinct from new.booking_close_reports_fallback_hours;
  end if;

  if schedule_changed and new.booking_close_reports_sent_at is null then
    new.booking_close_reports_dispatch_token := gen_random_uuid();
    new.booking_close_reports_status := 'pending';
    new.booking_close_reports_claimed_at := null;
    new.booking_close_reports_last_error := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_events_booking_close_reports_schedule on public.events;
create trigger trg_events_booking_close_reports_schedule
before insert or update of date_start, booking_closes_at, booking_close_reports_fallback_hours
on public.events
for each row execute function public.set_event_booking_close_reports_schedule();

-- Make the feature immediately applicable to events that already exist.
update public.events
set booking_close_reports_scheduled_for = coalesce(
      booking_closes_at,
      date_start - make_interval(hours => booking_close_reports_fallback_hours)
    ),
    booking_close_reports_status = case when booking_close_reports_sent_at is null then 'pending' else booking_close_reports_status end,
    booking_close_reports_claimed_at = case when booking_close_reports_sent_at is null then null else booking_close_reports_claimed_at end,
    booking_close_reports_last_error = case when booking_close_reports_sent_at is null then null else booking_close_reports_last_error end
where booking_close_reports_scheduled_for is null;

-- Atomic/idempotent sender claim. A crashed sender may be reclaimed after 15 min.
create or replace function public.claim_event_booking_close_reports(
  p_event_id uuid,
  p_dispatch_token uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  row_event public.events%rowtype;
begin
  select * into row_event
  from public.events
  where id = p_event_id
    and booking_close_reports_dispatch_token = p_dispatch_token
  for update;

  if not found then return 'stale'; end if;
  if row_event.booking_close_reports_sent_at is not null then return 'sent'; end if;
  if row_event.date_start <= now() then return 'past_event'; end if;
  if row_event.booking_close_reports_scheduled_for is null then return 'not_scheduled'; end if;
  if row_event.booking_close_reports_scheduled_for > now() + interval '30 seconds' then return 'too_early'; end if;
  if row_event.booking_close_reports_status = 'sending'
     and row_event.booking_close_reports_claimed_at is not null
     and row_event.booking_close_reports_claimed_at > now() - interval '15 minutes' then
    return 'busy';
  end if;

  update public.events
  set booking_close_reports_status = 'sending',
      booking_close_reports_claimed_at = now(),
      booking_close_reports_last_error = null
  where id = p_event_id;
  return 'claimed';
end;
$$;

revoke all on function public.claim_event_booking_close_reports(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_event_booking_close_reports(uuid, uuid) to service_role;

comment on column public.events.booking_close_reports_fallback_hours is
  'Hours before date_start when reports are sent if booking_closes_at is null. Default 2, including existing events.';
comment on column public.events.booking_close_reports_dispatch_token is
  'Opaque token required by the internal dispatcher callback; rotated when an unsent schedule changes.';
comment on column public.events.booking_close_reports_scheduled_for is
  'Effective report delivery time: booking_closes_at, otherwise date_start minus fallback hours.';
comment on column public.events.booking_close_reports_status is
  'Automatic report lifecycle: pending, sending, sent, error.';
comment on column public.events.booking_close_reports_sent_at is
  'Timestamp when n8n accepted the email containing all three closing reports.';
comment on column public.tenant_notification_recipients.notify_event_booking_closed_reports is
  'Receive the three event operational reports automatically at reservation closing time.';
