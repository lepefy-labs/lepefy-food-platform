-- 106_tester_feedback.sql
-- Multi-tenant tester feedback campaigns and privacy-preserving entries.
begin;

create table public.tester_feedback_campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  version_label text check (version_label is null or char_length(version_label) <= 80),
  active boolean not null default false,
  headline text not null check (char_length(btrim(headline)) between 1 and 240),
  intro text check (intro is null or char_length(intro) <= 2000),
  thank_you_message text check (thank_you_message is null or char_length(thank_you_message) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (id, tenant_id)
);

create unique index tester_feedback_one_active_per_tenant_idx
  on public.tester_feedback_campaigns (tenant_id) where active;
create index tester_feedback_campaigns_tenant_created_idx
  on public.tester_feedback_campaigns (tenant_id, created_at desc);
create index tester_feedback_campaigns_active_lookup_idx
  on public.tester_feedback_campaigns (tenant_id, active) where active;

create table public.tester_feedback_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  campaign_id uuid not null,
  reaction text check (reaction is null or reaction in ('great', 'good', 'neutral', 'difficult', 'bad')),
  category text check (category is null or category in ('bug', 'idea', 'confusing', 'like', 'other')),
  message text not null check (char_length(btrim(message)) between 1 and 4000),
  contact_allowed boolean not null default false,
  contact_email text,
  status text not null default 'new' check (status in ('new', 'review', 'planned', 'resolved', 'archived')),
  priority text not null default 'normal' check (priority in ('normal', 'important', 'blocking')),
  internal_note text check (internal_note is null or char_length(internal_note) <= 4000),
  context jsonb not null default '{}'::jsonb check (jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tester_feedback_campaign_tenant_fkey
    foreign key (campaign_id, tenant_id)
    references public.tester_feedback_campaigns (id, tenant_id)
    on delete cascade,
  constraint tester_feedback_contact_consent_check check (
    (contact_allowed and contact_email is not null)
    or (not contact_allowed and contact_email is null)
  )
);

create index tester_feedback_entries_tenant_created_idx
  on public.tester_feedback_entries (tenant_id, created_at desc);
create index tester_feedback_entries_campaign_created_idx
  on public.tester_feedback_entries (campaign_id, created_at desc);
create index tester_feedback_entries_workflow_idx
  on public.tester_feedback_entries (status, priority, created_at desc);

create function public.set_tester_feedback_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tester_feedback_campaigns_updated_at
before update on public.tester_feedback_campaigns
for each row execute function public.set_tester_feedback_updated_at();

create trigger tester_feedback_entries_updated_at
before update on public.tester_feedback_entries
for each row execute function public.set_tester_feedback_updated_at();

create function public.set_tester_feedback_campaign_active(
  p_campaign_id uuid,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from public.tester_feedback_campaigns
  where id = p_campaign_id
  for update;

  if v_tenant_id is null then
    raise exception 'campaign_not_found';
  end if;

  -- Serialize activation decisions per tenant, including concurrent activation
  -- requests targeting two different campaigns.
  perform 1 from public.tenants where id = v_tenant_id for update;

  if p_active then
    update public.tester_feedback_campaigns
    set active = false, closed_at = coalesce(closed_at, now())
    where tenant_id = v_tenant_id and active and id <> p_campaign_id;

    update public.tester_feedback_campaigns
    set active = true, closed_at = null
    where id = p_campaign_id;
  else
    update public.tester_feedback_campaigns
    set active = false, closed_at = coalesce(closed_at, now())
    where id = p_campaign_id;
  end if;
end;
$$;

create view public.tester_feedback_campaign_admin
with (security_invoker = true)
as
select
  campaign.id,
  campaign.tenant_id,
  campaign.name,
  campaign.version_label,
  campaign.active,
  campaign.headline,
  campaign.intro,
  campaign.thank_you_message,
  campaign.created_at,
  campaign.updated_at,
  campaign.closed_at,
  count(entry.id)::bigint as feedback_count
from public.tester_feedback_campaigns campaign
left join public.tester_feedback_entries entry on entry.campaign_id = campaign.id
group by campaign.id;

alter table public.tester_feedback_campaigns enable row level security;
alter table public.tester_feedback_campaigns force row level security;
alter table public.tester_feedback_entries enable row level security;
alter table public.tester_feedback_entries force row level security;

revoke all on public.tester_feedback_campaigns from anon, authenticated;
revoke all on public.tester_feedback_entries from anon, authenticated;
grant select, insert, update, delete on public.tester_feedback_campaigns to service_role;
grant select, insert, update, delete on public.tester_feedback_entries to service_role;
revoke all on public.tester_feedback_campaign_admin from anon, authenticated;
grant select on public.tester_feedback_campaign_admin to service_role;

revoke all on function public.set_tester_feedback_campaign_active(uuid, boolean) from public;
grant execute on function public.set_tester_feedback_campaign_active(uuid, boolean) to service_role;

comment on table public.tester_feedback_campaigns is
  'Tenant-scoped public feedback campaigns. At most one campaign is active per tenant.';
comment on table public.tester_feedback_entries is
  'Tester feedback submitted through trusted server routes. Browser roles have no direct access.';
comment on column public.tester_feedback_entries.context is
  'Minimal non-identifying diagnostics. Never stores raw IP addresses or device fingerprints.';

commit;
