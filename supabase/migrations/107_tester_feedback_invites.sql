-- 107_tester_feedback_invites.sql
-- Per-campaign tester invitations with hashed bearer credentials.
begin;

alter table public.tester_feedback_campaigns
  add column google_play_test_url text,
  add constraint tester_feedback_google_play_url_check check (
    google_play_test_url is null or google_play_test_url ~* '^https://play\.google\.com(/|$)'
  );

create table public.tester_feedback_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  email text not null check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  invite_token_hash text check (invite_token_hash is null or invite_token_hash ~ '^[0-9a-f]{64}$'),
  invite_token_created_at timestamptz,
  invite_token_used_at timestamptz,
  session_token_hash text check (session_token_hash is null or session_token_hash ~ '^[0-9a-f]{64}$'),
  activated_at timestamptz,
  delivery_status text not null default 'pending'
    check (delivery_status in ('pending', 'sent', 'delivery_failed', 'activated', 'revoked')),
  sent_at timestamptz,
  delivery_failed_at timestamptz,
  revoked_at timestamptz,
  last_feedback_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email),
  unique (id, campaign_id, tenant_id),
  constraint tester_feedback_invite_campaign_tenant_fkey foreign key (campaign_id, tenant_id)
    references public.tester_feedback_campaigns (id, tenant_id) on delete cascade,
  constraint tester_feedback_invite_activation_check check (
    (revoked_at is not null and session_token_hash is null)
    or (activated_at is null and session_token_hash is null)
    or (activated_at is not null and session_token_hash is not null and invite_token_used_at is not null)
  ),
  constraint tester_feedback_invite_revocation_check check (
    revoked_at is null or (delivery_status = 'revoked' and invite_token_hash is null and session_token_hash is null)
  ),
  constraint tester_feedback_invite_delivery_check check (
    (delivery_status = 'pending' and sent_at is null and activated_at is null and revoked_at is null)
    or (delivery_status = 'sent' and sent_at is not null and activated_at is null and revoked_at is null)
    or (delivery_status = 'delivery_failed' and sent_at is null and delivery_failed_at is not null and activated_at is null and revoked_at is null)
    or (delivery_status = 'activated' and sent_at is not null and activated_at is not null and revoked_at is null)
    or (delivery_status = 'revoked' and revoked_at is not null)
  )
);

create unique index tester_feedback_invites_token_idx on public.tester_feedback_invites (invite_token_hash) where invite_token_hash is not null;
create unique index tester_feedback_invites_session_idx on public.tester_feedback_invites (session_token_hash) where session_token_hash is not null;
create index tester_feedback_invites_campaign_status_idx on public.tester_feedback_invites (campaign_id, delivery_status, created_at);

create trigger tester_feedback_invites_updated_at before update on public.tester_feedback_invites
for each row execute function public.set_tester_feedback_updated_at();

alter table public.tester_feedback_entries
  add column tester_invite_id uuid,
  add constraint tester_feedback_entry_invite_fkey foreign key (tester_invite_id, campaign_id, tenant_id)
    references public.tester_feedback_invites (id, campaign_id, tenant_id) on delete restrict;

create index tester_feedback_entries_invite_idx on public.tester_feedback_entries (tester_invite_id, created_at desc)
where tester_invite_id is not null;

create or replace view public.tester_feedback_campaign_admin with (security_invoker = true) as
select campaign.id, campaign.tenant_id, campaign.name, campaign.version_label, campaign.active,
  campaign.headline, campaign.intro, campaign.thank_you_message, campaign.created_at,
  campaign.updated_at, campaign.closed_at, count(distinct entry.id)::bigint as feedback_count,
  campaign.google_play_test_url,
  count(distinct invite.id)::bigint as invited_count,
  count(distinct invite.id) filter (where invite.sent_at is not null)::bigint as sent_count,
  count(distinct invite.id) filter (where invite.activated_at is not null)::bigint as activated_count,
  count(distinct invite.id) filter (where invite.last_feedback_at is not null)::bigint as with_feedback_count
from public.tester_feedback_campaigns campaign
left join public.tester_feedback_entries entry on entry.campaign_id = campaign.id
left join public.tester_feedback_invites invite on invite.campaign_id = campaign.id
group by campaign.id;

alter table public.tester_feedback_invites enable row level security;
alter table public.tester_feedback_invites force row level security;
revoke all on public.tester_feedback_invites from anon, authenticated;
grant select, insert, update, delete on public.tester_feedback_invites to service_role;

comment on table public.tester_feedback_invites is 'Platform-managed tester invitations. Raw invite and session credentials are never persisted.';
comment on column public.tester_feedback_entries.tester_invite_id is 'Present only when an activated, non-revoked Lepefy tester session submitted the feedback.';
comment on column public.tester_feedback_campaigns.google_play_test_url is 'Official Google Play closed-test URL; Lepefy activation is not proof of Google Play opt-in.';

commit;
