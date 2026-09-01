-- MIGRATION 096: TENANT FEATURE SETTINGS
-- Moves Nala operational activation out of the tenants row into a generic configuration layer.

create table if not exists public.tenant_feature_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.platform_features(key),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

comment on table public.tenant_feature_settings is
  'Tenant-owned operational configuration. Commercial access remains in plans and entitlement overrides.';

alter table public.tenant_feature_settings enable row level security;

revoke all on table public.tenant_feature_settings from public, anon, authenticated;
grant select, insert, update, delete on public.tenant_feature_settings to service_role;

-- Preserve every existing tenant's operational choice before removing the legacy column.
insert into public.tenant_feature_settings (tenant_id, feature_key, enabled)
select id, 'nala', ai_chatbox_enabled
from public.tenants
on conflict (tenant_id, feature_key) do update set
  enabled = excluded.enabled,
  updated_at = now();

-- Abort instead of dropping the source column if any existing tenant was not backfilled.
do $$
declare
  tenant_count bigint;
  nala_setting_count bigint;
begin
  select count(*) into tenant_count
  from public.tenants;

  select count(*) into nala_setting_count
  from public.tenant_feature_settings settings
  inner join public.tenants tenant on tenant.id = settings.tenant_id
  where settings.feature_key = 'nala';

  if tenant_count <> nala_setting_count then
    raise exception
      'Nala operational setting backfill mismatch: tenants=%, settings=%',
      tenant_count,
      nala_setting_count;
  end if;
end
$$;

-- Migration 076 granted this legacy column explicitly to browser roles.
-- Remove that column-level privilege before evolving the current schema.
revoke select (ai_chatbox_enabled) on table public.tenants from anon, authenticated;

alter table public.tenants
  drop column ai_chatbox_enabled;
