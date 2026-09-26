begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  c constant uuid := '33333333-3333-4333-8333-333333333333';
  d constant uuid := '44444444-4444-4444-8444-444444444444';
  before_updated timestamptz;
begin
  -- Catalog: included module, never granted through plans or overrides.
  if not exists (select 1 from public.platform_features where key = 'referral' and active and not billable)
    then raise exception 'referral must be an active non-billable feature'; end if;
  if exists (select 1 from public.platform_plan_features where feature_key = 'referral')
     or exists (select 1 from public.tenant_feature_overrides where feature_key = 'referral')
    then raise exception 'referral must not create plan features or overrides'; end if;

  -- Backfill: one enabled row per tenant, values identical to the columns.
  if (select count(*) from public.tenant_feature_settings where feature_key = 'referral' and enabled) <> 3
    then raise exception 'Expected one enabled referral row per tenant'; end if;
  if (select config from public.tenant_feature_settings where tenant_id = a and feature_key = 'referral') <>
     '{"version": 1, "max_depth": 3, "signup_bonus_points": 50, "availability_mode": "SPENDING_THRESHOLD", "unlock_spending_threshold": 120.50, "fraud_max_conversions": 10, "fraud_period_days": 30, "fraud_action": "AUTO_BLOCK"}'::jsonb
    then raise exception 'Tenant A referral backfill mismatch'; end if;
  if (select config->'unlock_spending_threshold' from public.tenant_feature_settings where tenant_id = b and feature_key = 'referral') <> 'null'::jsonb
    then raise exception 'Null threshold must stay null'; end if;
  if (select (config->>'fraud_max_conversions')::numeric from public.tenant_feature_settings where tenant_id = c and feature_key = 'referral') <> 2.5
    then raise exception 'Fractional fraud threshold must be preserved'; end if;

  -- Other modules (loyalty after 131, Nala, reviews, digest) untouched.
  if exists (
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public._fixture_settings_before_132)
    except
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public.tenant_feature_settings)
  ) then raise exception 'Non-referral module settings were modified'; end if;

  -- Settings -> tenants mirror.
  update public.tenant_feature_settings
  set config = config || '{"max_depth": 5, "fraud_action": "CAP_AT_THRESHOLD", "unlock_spending_threshold": null}'
  where tenant_id = a and feature_key = 'referral';
  if (select referral_max_depth from public.tenants where id = a) <> 5
     or (select referral_fraud_action from public.tenants where id = a) <> 'CAP_AT_THRESHOLD'
     or (select referral_unlock_spending_threshold from public.tenants where id = a) is not null
     or (select referral_signup_bonus_points from public.tenants where id = a) <> 50
    then raise exception 'Settings change not mirrored to tenants'; end if;

  -- Tenants -> settings mirror.
  update public.tenants set referral_fraud_period_days = 90, referral_signup_bonus_points = 15 where id = b;
  if (select (config->>'fraud_period_days')::int from public.tenant_feature_settings where tenant_id = b and feature_key = 'referral') <> 90
     or (select (config->>'signup_bonus_points')::int from public.tenant_feature_settings where tenant_id = b and feature_key = 'referral') <> 15
     or (select config->'version' from public.tenant_feature_settings where tenant_id = b and feature_key = 'referral') <> '1'::jsonb
    then raise exception 'Tenant change not mirrored to settings'; end if;

  -- No-op writes do not rewrite the other side; other tenants untouched.
  select updated_at into before_updated from public.tenant_feature_settings where tenant_id = c and feature_key = 'referral';
  update public.tenants set name = 'Tenant C renamed', referral_fraud_period_days = 7 where id = c;
  if (select updated_at from public.tenant_feature_settings where tenant_id = c and feature_key = 'referral') <> before_updated
    then raise exception 'Unchanged referral values must not rewrite settings'; end if;
  if (select referral_availability_mode from public.tenants where id = c) <> 'ADMIN_GRANTED_ONLY'
    then raise exception 'Another tenant was modified'; end if;

  -- New tenants get a referral row with the column defaults.
  insert into public.tenants (id, slug, name) values (d, 'tenant-d', 'Tenant D');
  if not exists (select 1 from public.tenant_feature_settings where tenant_id = d and feature_key = 'referral' and enabled
      and (config->>'max_depth')::int = 2 and config->>'availability_mode' = 'ALL_CUSTOMERS')
    then raise exception 'New tenant must receive a referral row'; end if;

  -- Config constraint, scoped to referral; bad types are rejected, not cast errors.
  begin
    update public.tenant_feature_settings set config = '{"max_depth": 6}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"fraud_max_conversions": "ten"}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"fraud_action": "DELETE"}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"unlock_spending_threshold": 1.234}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"fraud_period_days": 0}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"webhook_secret": "x"}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  update public.tenant_feature_settings set config = '{"max_depth": 6}' where tenant_id = a and feature_key = 'reviews';

  -- Privileges: anti-fraud thresholds and referral settings are server-only.
  if has_column_privilege('anon', 'public.tenants', 'referral_fraud_max_conversions', 'select')
     or has_column_privilege('anon', 'public.tenants', 'referral_fraud_action', 'select')
     or has_column_privilege('authenticated', 'public.tenants', 'referral_signup_bonus_points', 'select')
     or has_column_privilege('authenticated', 'public.tenants', 'referral_availability_mode', 'select')
    then raise exception 'Referral columns must not stay publicly readable'; end if;
  if not has_column_privilege('anon', 'public.tenants', 'name', 'select')
    then raise exception 'Public branding grants must be preserved'; end if;
  if has_function_privilege('anon', 'public.is_valid_referral_config(jsonb)', 'execute')
    then raise exception 'Validator must not be public'; end if;
end $$;
rollback;
