-- MIGRATION 133: REFERRAL LEGACY CLEANUP (phase 5 of the referral consolidation)
--
-- DESTRUCTIVE: drops the seven tenants.referral_* setting columns.
-- tenant_feature_settings('referral') (migration 132) becomes the only source
-- of truth. customers.referral_* (access, suspension) and referral_codes /
-- referral_links are NOT touched.
--
-- Preconditions (enforced below; the migration aborts otherwise):
--   * migration 132 applied: 'referral' registered;
--   * every tenant has a referral settings row identical to its legacy columns.
-- Deployment order: deploy the application commit that no longer falls back
-- to the legacy columns FIRST, then apply this migration.
--
-- Rollback (restores the pre-133 schema from the settings rows):
--   alter table public.tenants
--     add column referral_max_depth integer not null default 2
--       check (referral_max_depth >= 1 and referral_max_depth <= 5),
--     add column referral_signup_bonus_points integer not null default 0,
--     add column referral_fraud_max_conversions numeric not null default 10,
--     add column referral_fraud_period_days integer not null default 30,
--     add column referral_fraud_action text not null default 'FLAG_FOR_REVIEW'
--       check (referral_fraud_action in ('FLAG_FOR_REVIEW','AUTO_BLOCK','CAP_AT_THRESHOLD')),
--     add column referral_availability_mode text not null default 'ALL_CUSTOMERS'
--       check (referral_availability_mode in ('ALL_CUSTOMERS','SPENDING_THRESHOLD','ADMIN_GRANTED_ONLY')),
--     add column referral_unlock_spending_threshold numeric(10,2);
--   update public.tenants t set
--     referral_max_depth = coalesce((s.config->>'max_depth')::int, 2),
--     referral_signup_bonus_points = coalesce((s.config->>'signup_bonus_points')::int, 0),
--     referral_availability_mode = coalesce(s.config->>'availability_mode', 'ALL_CUSTOMERS'),
--     referral_unlock_spending_threshold = (s.config->>'unlock_spending_threshold')::numeric,
--     referral_fraud_max_conversions = coalesce((s.config->>'fraud_max_conversions')::numeric, 10),
--     referral_fraud_period_days = coalesce((s.config->>'fraud_period_days')::int, 30),
--     referral_fraud_action = coalesce(s.config->>'fraud_action', 'FLAG_FOR_REVIEW')
--   from public.tenant_feature_settings s where s.tenant_id = t.id and s.feature_key = 'referral';
--   then re-apply sections 3–4 of 132.
--
-- Safe to re-run: every step is guarded.

begin;

-- ─── 1. Preconditions ─────────────────────────────────────────────────────────
do $$
declare
  legacy_columns int;
  tenant_count bigint;
  matching_count bigint;
begin
  if not exists (select 1 from public.platform_features where key = 'referral') then
    raise exception 'Migration 132 must be applied before 133 (referral feature missing)';
  end if;

  select count(*) into legacy_columns
  from information_schema.columns
  where table_schema = 'public' and table_name = 'tenants'
    and column_name in (
      'referral_max_depth', 'referral_signup_bonus_points', 'referral_availability_mode',
      'referral_unlock_spending_threshold', 'referral_fraud_max_conversions',
      'referral_fraud_period_days', 'referral_fraud_action'
    );

  select count(*) into tenant_count from public.tenants;

  if legacy_columns = 7 then
    execute $sql$
      select count(*)
      from public.tenants t
      join public.tenant_feature_settings s on s.tenant_id = t.id and s.feature_key = 'referral'
      where coalesce((s.config->>'max_depth')::int, 2) = t.referral_max_depth
        and coalesce((s.config->>'signup_bonus_points')::int, 0) = t.referral_signup_bonus_points
        and coalesce(s.config->>'availability_mode', 'ALL_CUSTOMERS') = t.referral_availability_mode
        and (s.config->>'unlock_spending_threshold')::numeric is not distinct from t.referral_unlock_spending_threshold
        and coalesce((s.config->>'fraud_max_conversions')::numeric, 10) = t.referral_fraud_max_conversions
        and coalesce((s.config->>'fraud_period_days')::int, 30) = t.referral_fraud_period_days
        and coalesce(s.config->>'fraud_action', 'FLAG_FOR_REVIEW') = t.referral_fraud_action
    $sql$ into matching_count;
    if matching_count <> tenant_count then
      raise exception 'Referral settings differ from legacy columns (tenants=%, matching=%): aborting before any drop',
        tenant_count, matching_count;
    end if;
  elsif legacy_columns <> 0 then
    raise exception 'Partial legacy referral columns (%/7): manual review required', legacy_columns;
  end if;

  select count(*) into matching_count
  from public.tenant_feature_settings
  where feature_key = 'referral';
  if matching_count <> tenant_count then
    raise exception 'Every tenant needs a referral settings row (tenants=%, rows=%)', tenant_count, matching_count;
  end if;
end
$$;

-- ─── 2. Remove the 132 mirror ─────────────────────────────────────────────────
drop trigger if exists tenant_feature_settings_referral_sync on public.tenant_feature_settings;
drop trigger if exists tenants_referral_settings_sync on public.tenants;
drop function if exists public.sync_referral_settings_to_tenant();
drop function if exists public.sync_tenant_referral_to_settings();
drop function if exists public.referral_config_from_tenant(public.tenants);

-- ─── 3. Drop the legacy columns ───────────────────────────────────────────────
-- New tenants get no automatic row any more: the application treats a missing
-- row as the 040 defaults (the values a new tenant had before).
alter table public.tenants
  drop column if exists referral_max_depth,
  drop column if exists referral_signup_bonus_points,
  drop column if exists referral_availability_mode,
  drop column if exists referral_unlock_spending_threshold,
  drop column if exists referral_fraud_max_conversions,
  drop column if exists referral_fraud_period_days,
  drop column if exists referral_fraud_action;

commit;
