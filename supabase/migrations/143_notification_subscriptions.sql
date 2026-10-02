-- 143 — Internal notification subscriptions: one row per (recipient, type, channel).
--
-- Until now every internal notification type was a boolean column on
-- tenant_notification_recipients (notify_*, migrations 071/080/093/129/135):
-- each new type cost a migration + type + API + UI change. From here on the
-- catalogue of types lives in code (apps/storefront/src/lib/notifications/
-- notificationTypes.ts) and the database only stores who subscribed to what:
-- adding a type no longer needs a migration.
--
--   tenant_notification_subscriptions(tenant_id, recipient_id, type_key, channel)
--   tenant_notification_recipients.admin_user_id  → optional link to a team
--     member: a recipient linked to a deactivated admin (or to an admin whose
--     membership of this tenant is inactive) stops receiving notifications.
--   notification_recipient_emails(tenant, type, channel) → the single lookup
--     used by every sender.
--
-- The legacy notify_* columns are backfilled then left in place, unused, so the
-- previous application version keeps working between this migration and the
-- deploy. They are dropped by a later migration once the new code is live.
-- Applying this file twice is harmless.

alter table public.tenant_notification_recipients
  add column if not exists admin_user_id uuid references public.admin_users(id) on delete set null;

create unique index if not exists idx_tenant_notification_recipients_admin_user
  on public.tenant_notification_recipients(tenant_id, admin_user_id)
  where admin_user_id is not null;

-- Composite target for the tenant-scoped FK below.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_notification_recipients_tenant_id_id_key'
      and conrelid = 'public.tenant_notification_recipients'::regclass
  ) then
    alter table public.tenant_notification_recipients
      add constraint tenant_notification_recipients_tenant_id_id_key unique (tenant_id, id);
  end if;
end $$;

create table if not exists public.tenant_notification_subscriptions (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  recipient_id uuid not null,
  -- Validated against the code registry by the API; the format check only
  -- guards against garbage, so a new type never needs a migration.
  type_key     text not null check (type_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  channel      text not null default 'email' check (channel in ('email')),
  created_at   timestamptz not null default now(),
  primary key (recipient_id, type_key, channel),
  foreign key (tenant_id, recipient_id)
    references public.tenant_notification_recipients(tenant_id, id) on delete cascade
);

create index if not exists idx_tenant_notification_subscriptions_lookup
  on public.tenant_notification_subscriptions(tenant_id, type_key, channel);

comment on table public.tenant_notification_subscriptions is
  'Abonnements des destinataires internes aux types de notification (catalogue dans le code : lib/notifications/notificationTypes.ts). Remplace les colonnes notify_* de tenant_notification_recipients.';

alter table public.tenant_notification_subscriptions enable row level security;
revoke all on table public.tenant_notification_subscriptions from anon, authenticated;
grant select, insert, delete on table public.tenant_notification_subscriptions to service_role;

-- Backfill from the legacy flags, once: skipped as soon as any subscription
-- exists so a re-run never resubscribes someone who opted out since.
do $$
declare
  legacy record;
begin
  if exists (select 1 from public.tenant_notification_subscriptions) then
    return;
  end if;
  for legacy in
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenant_notification_recipients'
      and column_name in (
        'notify_card_payment', 'notify_external_payment_pending', 'notify_order_stock_conflict',
        'notify_event_booking_closed_reports', 'notify_daily_digest',
        'notify_service_inquiries', 'notify_rental_reservations'
      )
  loop
    execute format(
      'insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel)
       select tenant_id, id, %L, ''email'' from public.tenant_notification_recipients where %I
       on conflict do nothing',
      substring(legacy.column_name from 8), legacy.column_name
    );
  end loop;
end $$;

-- Single lookup for every sender: active recipient, subscribed, and (when
-- linked to a team member) that admin still active on this tenant.
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

comment on column public.tenant_notification_recipients.admin_user_id is
  'Membre de l''équipe lié (optionnel). Désactiver l''admin ou son accès au tenant coupe ses notifications.';
