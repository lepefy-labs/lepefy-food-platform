begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  d constant uuid := '44444444-4444-4444-8444-444444444444';
begin
  -- Legacy setting columns, mirror triggers and helper functions are gone.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants'
      and column_name in ('referral_max_depth', 'referral_signup_bonus_points', 'referral_availability_mode',
        'referral_unlock_spending_threshold', 'referral_fraud_max_conversions', 'referral_fraud_period_days',
        'referral_fraud_action'))
    then raise exception 'Legacy referral columns must be dropped'; end if;
  if exists (select 1 from pg_trigger where tgname in ('tenant_feature_settings_referral_sync', 'tenants_referral_settings_sync'))
     or exists (select 1 from pg_proc where proname in ('sync_referral_settings_to_tenant', 'sync_tenant_referral_to_settings', 'referral_config_from_tenant'))
    then raise exception 'Referral mirror triggers and helpers must be removed'; end if;

  -- Every module row (referral, loyalty, Nala, reviews, digest) is preserved exactly.
  if exists (
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public._fixture_settings_before_133)
    except
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public.tenant_feature_settings)
  ) or (select count(*) from public.tenant_feature_settings) is distinct from (select count(*) from public._fixture_settings_before_133)
    then raise exception 'Module settings changed'; end if;

  -- The validator still guards the settings row.
  update public.tenant_feature_settings set config = config || '{"max_depth": 4}'
  where tenant_id = a and feature_key = 'referral';
  begin
    update public.tenant_feature_settings set config = '{"max_depth": 9}' where tenant_id = a and feature_key = 'referral';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;

  -- New tenants: no trigger fires and no automatic referral row is created.
  insert into public.tenants (id, slug, name) values (d, 'tenant-d', 'Tenant D');
  if exists (select 1 from public.tenant_feature_settings where tenant_id = d and feature_key = 'referral')
    then raise exception 'No automatic referral row expected after 133'; end if;
end $$;
rollback;
