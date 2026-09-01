-- MIGRATION 094: FEATURE ENTITLEMENTS FOUNDATION
-- Additive catalog, plan feature normalization, and tenant-level commercial overrides.

create table if not exists public.platform_features (
  key text primary key,
  name text not null,
  description text,
  category text not null,
  active boolean not null default true,
  billable boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_features is
  'Canonical catalog of commercial capabilities that Lepefy plans and tenant overrides may grant.';

insert into public.platform_features (key, name, description, category, active, billable, position)
values
  ('shop', 'Boutique', 'Boutique commerce Lepefy.', 'commerce', true, true, 10),
  ('events', 'Événementiel', 'Module Événementiel Lepefy.', 'commerce', true, true, 20),
  ('digital_card', 'Carte digitale', 'Carte digitale du tenant.', 'platform', true, true, 30),
  ('ai', 'Intelligence IA', 'Fonctionnalités IA historiques du plan.', 'ai', true, true, 40),
  ('nala', 'Nala', 'Assistant conversationnel Nala.', 'ai', true, true, 50)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

-- Refuse to normalize the relationship if legacy data contains an unknown key.
do $$
begin
  if exists (
    select 1
    from public.platform_plan_features ppf
    left join public.platform_features pf on pf.key = ppf.feature_key
    where pf.key is null
  ) then
    raise exception 'platform_plan_features contains feature keys missing from platform_features';
  end if;
end
$$;

alter table public.platform_plan_features
  drop constraint if exists platform_plan_features_feature_key_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.platform_plan_features'::regclass
      and conname = 'platform_plan_features_feature_key_fkey'
  ) then
    alter table public.platform_plan_features
      add constraint platform_plan_features_feature_key_fkey
      foreign key (feature_key) references public.platform_features(key);
  end if;
end
$$;

-- Preserve the current all-inclusive offer while keeping operational activation separate.
insert into public.platform_plan_features (plan_id, feature_key, label, position)
select id, 'nala', 'Nala', 50
from public.platform_plans
where code = 'food-platform'
on conflict (plan_id, feature_key) do update set
  label = excluded.label,
  position = excluded.position;

create table if not exists public.tenant_feature_overrides (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.platform_features(key),
  enabled boolean not null,
  source text not null default 'manual'
    check (source in ('manual', 'addon', 'trial', 'promotion')),
  starts_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key),
  constraint tenant_feature_overrides_valid_window
    check (starts_at is null or expires_at is null or starts_at < expires_at)
);

comment on table public.tenant_feature_overrides is
  'Sparse tenant-specific commercial exceptions. Missing rows inherit the active plan entitlement.';

alter table public.platform_features enable row level security;
alter table public.tenant_feature_overrides enable row level security;

revoke all on table public.platform_features from anon, authenticated;
revoke all on table public.tenant_feature_overrides from anon, authenticated;

grant select, insert, update, delete on public.platform_features to service_role;
grant select, insert, update, delete on public.tenant_feature_overrides to service_role;
