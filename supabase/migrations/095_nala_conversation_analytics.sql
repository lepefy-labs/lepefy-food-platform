-- MIGRATION 095: NALA CONVERSATION ANALYTICS V1
-- Additive, service-role-only foundation for minimized conversation analytics.

insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'nala_analytics',
  'Nala Analytics',
  'Conversation analytics for Nala with minimized customer and request metadata.',
  'ai',
  true,
  true,
  60
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

insert into public.platform_plan_features (plan_id, feature_key, label, position)
select id, 'nala_analytics', 'Nala Analytics', 60
from public.platform_plans
where code = 'food-platform'
on conflict (plan_id, feature_key) do update set
  label = excluded.label,
  position = excluded.position;

create table if not exists public.nala_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  client_session_id uuid not null,
  customer_id uuid references public.customers(id) on delete set null,
  country_code text,
  region text,
  city text,
  locale text,
  device_type text not null default 'unknown'
    check (device_type in ('mobile', 'tablet', 'desktop', 'unknown')),
  entry_path text,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, client_session_id),
  check (country_code is null or char_length(country_code) = 2),
  check (region is null or char_length(region) <= 100),
  check (city is null or char_length(city) <= 120),
  check (locale is null or char_length(locale) <= 35),
  check (entry_path is null or (left(entry_path, 1) = '/' and char_length(entry_path) <= 500))
);

create table if not exists public.nala_interactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  session_id uuid not null references public.nala_sessions(id) on delete cascade,
  message_text text not null check (char_length(message_text) <= 300),
  reply_text text,
  source_path text
    check (source_path is null or (left(source_path, 1) = '/' and char_length(source_path) <= 500)),
  ai_call_triggered boolean not null default false,
  outcome text not null
    check (outcome in ('small_talk', 'rate_limited', 'answered', 'retrieval_empty', 'error')),
  intent text,
  matched_product_ids uuid[],
  matched_kb_ids uuid[],
  created_at timestamptz not null default now()
);

comment on table public.nala_sessions is
  'Nala conversation sessions with approximate geography and minimized metadata; no IP address, user-agent, fingerprint, or analytics cookie.';
comment on table public.nala_interactions is
  'Raw Nala conversation interactions. Retention target: 90 days via public.purge_expired_nala_analytics().';

create index if not exists nala_sessions_tenant_started_idx
  on public.nala_sessions (tenant_id, started_at desc);
create index if not exists nala_sessions_tenant_customer_started_idx
  on public.nala_sessions (tenant_id, customer_id, started_at desc);
create index if not exists nala_interactions_tenant_created_idx
  on public.nala_interactions (tenant_id, created_at desc);
create index if not exists nala_interactions_session_created_idx
  on public.nala_interactions (session_id, created_at);
create index if not exists nala_interactions_tenant_outcome_created_idx
  on public.nala_interactions (tenant_id, outcome, created_at desc);

alter table public.nala_sessions enable row level security;
alter table public.nala_interactions enable row level security;

revoke all on table public.nala_sessions from public, anon, authenticated;
revoke all on table public.nala_interactions from public, anon, authenticated;
grant select, insert, update, delete on public.nala_sessions to service_role;
grant select, insert, update, delete on public.nala_interactions to service_role;

create or replace function public.resolve_nala_session(
  p_tenant_id uuid,
  p_client_session_id uuid,
  p_customer_id uuid,
  p_country_code text,
  p_region text,
  p_city text,
  p_locale text,
  p_device_type text,
  p_entry_path text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_id uuid;
begin
  insert into public.nala_sessions (
    tenant_id, client_session_id, customer_id, country_code, region, city,
    locale, device_type, entry_path
  )
  values (
    p_tenant_id, p_client_session_id, p_customer_id, p_country_code, p_region, p_city,
    p_locale, p_device_type, p_entry_path
  )
  on conflict (tenant_id, client_session_id) do update
  set last_message_at = now(),
      customer_id = coalesce(nala_sessions.customer_id, excluded.customer_id)
  returning id into resolved_id;

  return resolved_id;
end;
$$;

revoke all on function public.resolve_nala_session(uuid, uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.resolve_nala_session(uuid, uuid, uuid, text, text, text, text, text, text)
  to service_role;

create or replace function public.purge_expired_nala_analytics()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_sessions bigint;
begin
  delete from public.nala_sessions
  where started_at < now() - interval '90 days';

  get diagnostics deleted_sessions = row_count;
  return deleted_sessions;
end;
$$;

comment on function public.purge_expired_nala_analytics() is
  'Deletes Nala sessions older than 90 days; interactions cascade. Invoke daily from an approved service-role scheduler.';
revoke all on function public.purge_expired_nala_analytics() from public, anon, authenticated;
grant execute on function public.purge_expired_nala_analytics() to service_role;
