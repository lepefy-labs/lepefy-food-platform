-- 158 — Staff notifications: WhatsApp channel, domain events, per-recipient
-- deliveries and the platform-owner order catch-up (« Rattrapage »).
--
-- Additive and re-runnable. Nothing is sent by this migration and no existing
-- preference changes: every existing subscription stays on the email channel,
-- WhatsApp subscriptions start empty (opt-in), the claim of the delivery ledger
-- keeps its email behaviour.
--
--   tenant_notification_recipients  email becomes optional, + whatsapp_phone
--                                   (E.164) and whatsapp_verified_at (set only
--                                   after a confirmed test message).
--   tenant_notification_subscriptions.channel  'email' | 'whatsapp'.
--   notification_recipient_targets()  the single lookup of the dispatcher.
--   tenant_notification_events      one immutable row per domain transition
--                                   (tenant, type, entity, occurrence).
--   notification_deliveries (136)   stays THE outbox: + channel, event_id,
--                                   recipient_id, provider status; statuses
--                                   delivered / skipped / unknown; transport
--                                   green_api. One row per event × recipient ×
--                                   channel through the existing unique key.
--   notification_backfill_runs      preview → confirmation of a manual catch-up,
--                                   never automatic.
--
-- Rollback (nothing else depends on it; run only once no code reads it):
--   drop table if exists public.notification_backfill_runs;
--   alter table public.notification_deliveries drop column if exists event_id, drop column if exists recipient_id,
--     drop column if exists channel, drop column if exists provider_status, drop column if exists provider_checked_at,
--     drop column if exists delivered_at;   -- then restore the 136/137 checks
--   drop table if exists public.tenant_notification_events;
--   drop function if exists public.notification_recipient_targets(uuid, text[], text);
--   delete from public.tenant_notification_subscriptions where channel = 'whatsapp';  -- then restore the 143 check
--   alter table public.tenant_notification_recipients drop column if exists whatsapp_phone, drop column if exists whatsapp_verified_at;
--   (email NOT NULL can be restored only once no WhatsApp-only recipient exists.)

begin;

-- ─── 1. Recipients: email and/or WhatsApp ──────────────────────────────────

alter table public.tenant_notification_recipients alter column email drop not null;
alter table public.tenant_notification_recipients add column if not exists whatsapp_phone text;
alter table public.tenant_notification_recipients add column if not exists whatsapp_verified_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenant_notification_recipients_whatsapp_phone_format'
                 and conrelid = 'public.tenant_notification_recipients'::regclass) then
    alter table public.tenant_notification_recipients
      add constraint tenant_notification_recipients_whatsapp_phone_format
      check (whatsapp_phone is null or whatsapp_phone ~ '^\+[1-9][0-9]{7,14}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_notification_recipients_contact_present'
                 and conrelid = 'public.tenant_notification_recipients'::regclass) then
    alter table public.tenant_notification_recipients
      add constraint tenant_notification_recipients_contact_present
      check (email is not null or whatsapp_phone is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenant_notification_recipients_verified_requires_phone'
                 and conrelid = 'public.tenant_notification_recipients'::regclass) then
    alter table public.tenant_notification_recipients
      add constraint tenant_notification_recipients_verified_requires_phone
      check (whatsapp_verified_at is null or whatsapp_phone is not null);
  end if;
end $$;

create unique index if not exists idx_tenant_notification_recipients_whatsapp
  on public.tenant_notification_recipients(tenant_id, whatsapp_phone)
  where whatsapp_phone is not null;

comment on column public.tenant_notification_recipients.whatsapp_phone is
  'Numéro WhatsApp du destinataire interne (E.164, +393…). Jamais le numéro commercial du tenant ni le numéro expéditeur Lepefy.';
comment on column public.tenant_notification_recipients.whatsapp_verified_at is
  'Réception d''un message de test confirmée par l''admin. Remis à null quand le numéro change. Sans cette date, aucun envoi WhatsApp automatique.';

-- ─── 2. Channels ────────────────────────────────────────────────────────────

alter table public.tenant_notification_subscriptions
  drop constraint if exists tenant_notification_subscriptions_channel_check;
alter table public.tenant_notification_subscriptions
  add constraint tenant_notification_subscriptions_channel_check check (channel in ('email', 'whatsapp'));

-- Email lookup (143) skips WhatsApp-only recipients.
create or replace function public.notification_recipient_emails(
  p_tenant_id uuid,
  p_type_key text,
  p_channel text default 'email'
)
returns table (email text)
language sql
stable
set search_path = public
as $$
  select r.email
  from public.tenant_notification_subscriptions s
  join public.tenant_notification_recipients r
    on r.tenant_id = s.tenant_id and r.id = s.recipient_id
  where s.tenant_id = p_tenant_id
    and s.type_key = p_type_key
    and s.channel = p_channel
    and r.active
    and r.email is not null
    and (
      r.admin_user_id is null
      or exists (
        select 1
        from public.admin_users a
        join public.admin_memberships m on m.user_id = a.id
        where a.id = r.admin_user_id
          and a.active
          and m.active
          and m.tenant_id = r.tenant_id
      )
    )
  order by r.created_at, r.email;
$$;

revoke all on function public.notification_recipient_emails(uuid, text, text) from public, anon, authenticated;
grant execute on function public.notification_recipient_emails(uuid, text, text) to service_role;

-- Dispatcher lookup: one row per (recipient, subscribed type) on a channel,
-- with the address of that channel. Same membership rule as above; WhatsApp
-- also requires a number whose test message was confirmed.
create or replace function public.notification_recipient_targets(
  p_tenant_id uuid,
  p_type_keys text[],
  p_channel text
)
returns table (recipient_id uuid, type_key text, address text)
language sql
stable
set search_path = public
as $$
  select r.id, s.type_key, case when p_channel = 'whatsapp' then r.whatsapp_phone else r.email end
  from public.tenant_notification_subscriptions s
  join public.tenant_notification_recipients r
    on r.tenant_id = s.tenant_id and r.id = s.recipient_id
  where s.tenant_id = p_tenant_id
    and s.type_key = any(p_type_keys)
    and s.channel = p_channel
    and r.active
    and (
      (p_channel = 'email' and r.email is not null)
      or (p_channel = 'whatsapp' and r.whatsapp_phone is not null and r.whatsapp_verified_at is not null)
    )
    and (
      r.admin_user_id is null
      or exists (
        select 1
        from public.admin_users a
        join public.admin_memberships m on m.user_id = a.id
        where a.id = r.admin_user_id
          and a.active
          and m.active
          and m.tenant_id = r.tenant_id
      )
    )
  order by r.created_at, r.id, s.type_key;
$$;

revoke all on function public.notification_recipient_targets(uuid, text[], text) from public, anon, authenticated;
grant execute on function public.notification_recipient_targets(uuid, text[], text) to service_role;

-- ─── 3. Domain events ───────────────────────────────────────────────────────

create table if not exists public.tenant_notification_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  event_type      text not null check (event_type ~ '^[a-z][a-z0-9_]{1,62}$'),
  entity_type     text not null check (entity_type ~ '^[a-z][a-z0-9_]{1,40}$'),
  entity_id       text not null check (char_length(entity_id) between 1 and 100),
  -- Stable identity of the transition (e.g. 'created', 'attempt:2'): a replayed
  -- webhook or a second worker produces the same row, never a second event.
  occurrence_id   text not null check (char_length(occurrence_id) between 1 and 120),
  priority        text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  source          text not null default 'live' check (source in ('live', 'backfill')),
  backfill_run_id uuid,
  -- Minimal snapshot for rendering (reference, short name, amount, flags):
  -- never a full address, payment detail or provider payload.
  payload         jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 8000),
  created_at      timestamptz not null default now(),
  unique (tenant_id, event_type, entity_type, entity_id, occurrence_id)
);

create index if not exists idx_tenant_notification_events_entity
  on public.tenant_notification_events(tenant_id, entity_type, entity_id);
create index if not exists idx_tenant_notification_events_recent
  on public.tenant_notification_events(tenant_id, created_at desc);

alter table public.tenant_notification_events enable row level security;
revoke all on table public.tenant_notification_events from public, anon, authenticated;
grant select, insert, delete on table public.tenant_notification_events to service_role;

comment on table public.tenant_notification_events is
  'Événements de notification interne (une ligne par transition métier). Les envois par destinataire et canal sont dans notification_deliveries.';

-- ─── 4. Delivery ledger = outbox of every channel ───────────────────────────

alter table public.notification_deliveries
  add column if not exists channel text not null default 'email';
alter table public.notification_deliveries
  add column if not exists event_id uuid references public.tenant_notification_events(id) on delete set null;
-- No FK: the history outlives a deleted recipient.
alter table public.notification_deliveries add column if not exists recipient_id uuid;
alter table public.notification_deliveries add column if not exists provider_status text;
alter table public.notification_deliveries add column if not exists provider_checked_at timestamptz;
alter table public.notification_deliveries add column if not exists delivered_at timestamptz;

alter table public.notification_deliveries drop constraint if exists notification_deliveries_channel_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_channel_check check (channel in ('email', 'whatsapp'));

alter table public.notification_deliveries drop constraint if exists notification_deliveries_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_status_check
  check (status in ('pending', 'processing', 'accepted', 'delivered', 'failed', 'dead', 'skipped', 'unknown'));

alter table public.notification_deliveries drop constraint if exists notification_deliveries_webhook_path_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_webhook_path_check check (webhook_path ~ '^/(webhook|whatsapp)/[a-z0-9-]+$');

alter table public.notification_deliveries drop constraint if exists notification_deliveries_transport_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_transport_check check (transport in ('n8n', 'brevo', 'green_api'));

alter table public.notification_deliveries drop constraint if exists notification_deliveries_provider_status_check;
alter table public.notification_deliveries
  add constraint notification_deliveries_provider_status_check check (provider_status is null or char_length(provider_status) <= 40);

create index if not exists notification_deliveries_event_idx
  on public.notification_deliveries (event_id) where event_id is not null;
create index if not exists notification_deliveries_recipient_idx
  on public.notification_deliveries (tenant_id, recipient_id, channel) where recipient_id is not null;
create index if not exists notification_deliveries_whatsapp_followup_idx
  on public.notification_deliveries (provider_checked_at)
  where channel = 'whatsapp' and status = 'accepted';

comment on column public.notification_deliveries.channel is
  'email (send-email / Brevo) ou whatsapp (Green API, numéro Lepefy). Une ligne par destinataire et canal pour les notifications du dispatcher.';

-- Same claim as 136, with one exception: a WhatsApp send interrupted while
-- 'processing' may already have reached the provider (no idempotency key at
-- Green API), so it is never re-claimed: the application marks it 'unknown'.
create or replace function public.claim_notification_deliveries(p_limit integer)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.notification_deliveries d
     set status = 'processing',
         attempts = d.attempts + 1,
         locked_until = now() + interval '2 minutes',
         updated_at = now()
   where d.id in (
     select c.id from public.notification_deliveries c
      where c.payload is not null
        and c.attempts < c.max_attempts
        and ((c.status in ('pending', 'failed') and c.next_attempt_at <= now())
          or (c.status = 'processing' and c.locked_until < now() and c.channel <> 'whatsapp'))
      order by c.next_attempt_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning d.*;
end
$$;

revoke all on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;

-- ─── 5. Manual catch-up of existing orders (platform owner) ─────────────────

create table if not exists public.notification_backfill_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  -- Generated by the browser at preview time: a double click confirms once.
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  status          text not null default 'previewed'
                    check (status in ('previewed', 'confirmed', 'completed', 'expired')),
  mode            text not null check (mode in ('individual', 'summary')),
  channels        text[] not null check (channels <@ array['email', 'whatsapp']::text[] and cardinality(channels) between 1 and 2),
  filters         jsonb not null default '{}'::jsonb,
  order_ids       uuid[] not null check (cardinality(order_ids) between 1 and 200),
  -- Hash of the eligible orders (id + updated_at) and planned deliveries at
  -- preview: confirmation is refused when the data changed meanwhile.
  fingerprint     text not null check (char_length(fingerprint) between 16 and 128),
  planned         jsonb not null default '{}'::jsonb,
  result          jsonb,
  created_by      uuid references public.admin_users(id) on delete set null,
  confirmed_by    uuid references public.admin_users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  confirmed_at    timestamptz,
  completed_at    timestamptz,
  unique (tenant_id, idempotency_key)
);

create index if not exists idx_notification_backfill_runs_recent
  on public.notification_backfill_runs(tenant_id, created_at desc);
-- One catch-up executing at a time per tenant: a second confirmation waits.
create unique index if not exists idx_notification_backfill_runs_one_running
  on public.notification_backfill_runs(tenant_id) where status = 'confirmed';

alter table public.notification_backfill_runs enable row level security;
revoke all on table public.notification_backfill_runs from public, anon, authenticated;
grant select, insert, update on table public.notification_backfill_runs to service_role;

comment on table public.notification_backfill_runs is
  'Rattrapage manuel des notifications de commandes existantes : aperçu puis confirmation explicite du propriétaire de la plateforme. Jamais déclenché automatiquement.';

-- ─── 6. Journal d'activité ──────────────────────────────────────────────────

do $$
begin
  if to_regclass('public.audit_event_types') is not null then
    insert into public.audit_event_types (key, module, category, default_severity, retention_class) values
      ('notifications.backfill.confirmed', 'notifications', 'activity', 'notice', 'business')
    on conflict (key) do nothing;
  end if;
end $$;

commit;
