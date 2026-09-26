-- MIGRATION 132: REFERRAL SETTINGS → tenant_feature_settings
--
-- Same approach as loyalty (130): additive step of the referral consolidation
-- (docs/TENANT_CONFIGURATION_ARCHITECTURE.md §3.5):
--   * registers the included, non-billable module 'referral';
--   * backfills one row per tenant from the seven tenants.referral_* columns
--     (count + value check); enabled = true for every tenant, because the
--     program has no switch of its own today (it follows loyalty.enabled);
--   * guarded two-way triggers keep the legacy columns identical until they
--     are dropped by a later migration;
--   * revokes the public 076 column grants (anti-fraud thresholds included).
-- No column is dropped; referral_codes, referral_links and points history are
-- never touched. Safe to re-run.

begin;

-- ─── 1. Catalog ───────────────────────────────────────────────────────────────
insert into public.platform_features (key, name, description, category, active, billable, position)
values (
  'referral',
  'Parrainage',
  'Parrainage multi-niveaux, bonus d''inscription et contrôles anti-fraude. Module inclus, non facturable.',
  'growth',
  true,
  false,
  220
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  active = excluded.active,
  billable = excluded.billable,
  position = excluded.position,
  updated_at = now();

-- ─── 2. Config validation (mirrors the 040 column types and CHECKs) ──────────
create or replace function public.is_valid_referral_config(p_config jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_catalog
as $$
declare
  v jsonb;
begin
  if jsonb_typeof(p_config) <> 'object' then return false; end if;
  if p_config - array[
    'version', 'max_depth', 'signup_bonus_points', 'availability_mode', 'unlock_spending_threshold',
    'fraud_max_conversions', 'fraud_period_days', 'fraud_action'
  ] <> '{}'::jsonb then return false; end if;

  -- Type checks come first in separate IFs: casts only ever see numbers.
  if p_config ? 'version' and p_config->'version' <> '1'::jsonb then return false; end if;

  v := p_config->'max_depth';
  if v is not null then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[1-5]$' then return false; end if;
  end if;

  v := p_config->'signup_bonus_points';
  if v is not null then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,7}$' then return false; end if;
  end if;

  v := p_config->'fraud_period_days';
  if v is not null then
    if jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ '^[0-9]{1,4}$' then return false; end if;
    if (v #>> '{}')::int not between 1 and 3650 then return false; end if;
  end if;

  v := p_config->'fraud_max_conversions';
  if v is not null then
    if jsonb_typeof(v) <> 'number' then return false; end if;
    if (v #>> '{}')::numeric not between 0 and 1000000 then return false; end if;
  end if;

  v := p_config->'unlock_spending_threshold';
  if v is not null and jsonb_typeof(v) <> 'null' then
    if jsonb_typeof(v) <> 'number' then return false; end if;
    if (v #>> '{}')::numeric not between 0 and 99999999.99
       or (v #>> '{}')::numeric <> round((v #>> '{}')::numeric, 2) then return false; end if;
  end if;

  v := p_config->'availability_mode';
  if v is not null then
    if jsonb_typeof(v) <> 'string'
       or (v #>> '{}') <> all (array['ALL_CUSTOMERS', 'SPENDING_THRESHOLD', 'ADMIN_GRANTED_ONLY']) then return false; end if;
  end if;

  v := p_config->'fraud_action';
  if v is not null then
    if jsonb_typeof(v) <> 'string'
       or (v #>> '{}') <> all (array['FLAG_FOR_REVIEW', 'AUTO_BLOCK', 'CAP_AT_THRESHOLD']) then return false; end if;
  end if;

  return true;
end
$$;

revoke all on function public.is_valid_referral_config(jsonb) from public, anon, authenticated;
grant execute on function public.is_valid_referral_config(jsonb) to service_role;

alter table public.tenant_feature_settings
  drop constraint if exists tenant_feature_settings_referral_config_check;
alter table public.tenant_feature_settings
  add constraint tenant_feature_settings_referral_config_check
  check (feature_key <> 'referral' or public.is_valid_referral_config(config));

-- ─── 3. Backfill every tenant ─────────────────────────────────────────────────
create or replace function public.referral_config_from_tenant(t public.tenants)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'version', 1,
    'max_depth', t.referral_max_depth,
    'signup_bonus_points', t.referral_signup_bonus_points,
    'availability_mode', t.referral_availability_mode,
    'unlock_spending_threshold', t.referral_unlock_spending_threshold,
    'fraud_max_conversions', t.referral_fraud_max_conversions,
    'fraud_period_days', t.referral_fraud_period_days,
    'fraud_action', t.referral_fraud_action
  );
$$;

revoke all on function public.referral_config_from_tenant(public.tenants) from public, anon, authenticated;

insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
select t.id, 'referral', true, public.referral_config_from_tenant(t)
from public.tenants t
on conflict (tenant_id, feature_key) do nothing;

-- ─── 4. Two-way sync (guarded: each side writes only when values differ) ─────
create or replace function public.sync_referral_settings_to_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c jsonb := new.config;
begin
  update public.tenants t
  set referral_max_depth = coalesce((c->>'max_depth')::int, 2),
      referral_signup_bonus_points = coalesce((c->>'signup_bonus_points')::int, 0),
      referral_availability_mode = coalesce(c->>'availability_mode', 'ALL_CUSTOMERS'),
      referral_unlock_spending_threshold = (c->>'unlock_spending_threshold')::numeric,
      referral_fraud_max_conversions = coalesce((c->>'fraud_max_conversions')::numeric, 10),
      referral_fraud_period_days = coalesce((c->>'fraud_period_days')::int, 30),
      referral_fraud_action = coalesce(c->>'fraud_action', 'FLAG_FOR_REVIEW')
  where t.id = new.tenant_id
    and public.referral_config_from_tenant(t) - 'version'
        is distinct from jsonb_build_object(
          'max_depth', coalesce((c->>'max_depth')::int, 2),
          'signup_bonus_points', coalesce((c->>'signup_bonus_points')::int, 0),
          'availability_mode', coalesce(c->>'availability_mode', 'ALL_CUSTOMERS'),
          'unlock_spending_threshold', (c->>'unlock_spending_threshold')::numeric,
          'fraud_max_conversions', coalesce((c->>'fraud_max_conversions')::numeric, 10),
          'fraud_period_days', coalesce((c->>'fraud_period_days')::int, 30),
          'fraud_action', coalesce(c->>'fraud_action', 'FLAG_FOR_REVIEW')
        );
  return new;
end
$$;

create or replace function public.sync_tenant_referral_to_settings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config jsonb := public.referral_config_from_tenant(new);
begin
  insert into public.tenant_feature_settings as s (tenant_id, feature_key, enabled, config)
  values (new.id, 'referral', true, v_config)
  on conflict (tenant_id, feature_key) do update
    set config = s.config || (v_config - 'version'),
        updated_at = now()
  where (s.config || (v_config - 'version')) is distinct from s.config;
  return new;
end
$$;

revoke all on function public.sync_referral_settings_to_tenant() from public, anon, authenticated;
revoke all on function public.sync_tenant_referral_to_settings() from public, anon, authenticated;

drop trigger if exists tenant_feature_settings_referral_sync on public.tenant_feature_settings;
create trigger tenant_feature_settings_referral_sync
  after insert or update of config on public.tenant_feature_settings
  for each row when (new.feature_key = 'referral')
  execute function public.sync_referral_settings_to_tenant();

drop trigger if exists tenants_referral_settings_sync on public.tenants;
create trigger tenants_referral_settings_sync
  after insert or update of referral_max_depth, referral_signup_bonus_points, referral_availability_mode,
    referral_unlock_spending_threshold, referral_fraud_max_conversions, referral_fraud_period_days,
    referral_fraud_action on public.tenants
  for each row
  execute function public.sync_tenant_referral_to_settings();

-- ─── 5. Verification: one identical row per tenant ───────────────────────────
do $$
declare
  tenant_count bigint;
  matching_count bigint;
begin
  select count(*) into tenant_count from public.tenants;
  select count(*) into matching_count
  from public.tenants t
  join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'referral'
  where s.config = public.referral_config_from_tenant(t);
  if tenant_count <> matching_count then
    raise exception 'Referral settings backfill mismatch: tenants=%, matching=%', tenant_count, matching_count;
  end if;
end
$$;

-- ─── 6. Referral settings are server-only (076 had granted them publicly) ────
revoke select (
  referral_max_depth, referral_signup_bonus_points, referral_availability_mode,
  referral_unlock_spending_threshold, referral_fraud_max_conversions,
  referral_fraud_period_days, referral_fraud_action
) on table public.tenants from anon, authenticated;

commit;
