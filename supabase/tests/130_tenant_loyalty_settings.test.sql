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
  if not exists (select 1 from public.platform_features where key = 'loyalty' and active and not billable)
    then raise exception 'loyalty must be an active non-billable feature'; end if;
  if exists (select 1 from public.platform_plan_features where feature_key = 'loyalty')
     or exists (select 1 from public.tenant_feature_overrides where feature_key = 'loyalty')
    then raise exception 'loyalty must not create plan features or overrides'; end if;

  -- Backfill: exactly one identical row per tenant, activation preserved.
  if (select count(*) from public.tenant_feature_settings where feature_key = 'loyalty') <> 3
    then raise exception 'Expected one loyalty row per tenant'; end if;
  if not exists (select 1 from public.tenant_feature_settings where tenant_id = a and feature_key = 'loyalty' and enabled
      and (config->>'purchase_points_rate')::numeric = 1.5 and (config->>'points_to_currency_rate')::numeric = 0.02 and config->'version' = '1')
     or not exists (select 1 from public.tenant_feature_settings where tenant_id = b and feature_key = 'loyalty' and not enabled)
     or not exists (select 1 from public.tenant_feature_settings where tenant_id = c and feature_key = 'loyalty' and enabled
      and (config->>'purchase_points_rate')::numeric = 2.2575 and (config->>'points_to_currency_rate')::numeric = 0.0525)
    then raise exception 'Loyalty backfill does not match the legacy columns'; end if;
  if exists (select 1 from public.tenant_feature_settings where feature_key = 'loyalty' and config ? 'referral_signup_bonus_points')
    then raise exception 'Referral values must stay out of the loyalty module'; end if;

  -- Other modules untouched (Nala from 096, reviews, daily digest from 129).
  if exists (
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public._fixture_settings_before)
    except
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public.tenant_feature_settings)
  ) then raise exception 'Non-loyalty module settings were modified'; end if;
  if (select enabled from public.tenant_feature_settings where tenant_id = a and feature_key = 'nala') is not true
    then raise exception 'Nala settings lost'; end if;

  -- Settings -> tenants mirror (legacy readers such as the in-store RPC).
  update public.tenant_feature_settings
  set config = config || '{"purchase_points_rate": 3.25}', enabled = false
  where tenant_id = a and feature_key = 'loyalty';
  if (select purchase_points_rate from public.tenants where id = a) <> 3.25
     or (select loyalty_enabled from public.tenants where id = a) is not false
    then raise exception 'Settings change not mirrored to tenants'; end if;
  if (select points_to_currency_rate from public.tenants where id = a) <> 0.02
    then raise exception 'Unchanged rate must be preserved'; end if;

  -- Tenants -> settings mirror (writes still reaching the legacy columns).
  update public.tenants set purchase_points_rate = 0.75, loyalty_enabled = true where id = b;
  if not exists (select 1 from public.tenant_feature_settings where tenant_id = b and feature_key = 'loyalty' and enabled
      and (config->>'purchase_points_rate')::numeric = 0.75 and config->'version' = '1')
    then raise exception 'Tenant change not mirrored to settings'; end if;

  -- No-op writes do not touch the other side.
  select updated_at into before_updated from public.tenant_feature_settings where tenant_id = c and feature_key = 'loyalty';
  update public.tenants set name = 'Tenant C renamed', purchase_points_rate = 2.2575 where id = c;
  if (select updated_at from public.tenant_feature_settings where tenant_id = c and feature_key = 'loyalty') <> before_updated
    then raise exception 'Unchanged loyalty values must not rewrite settings'; end if;

  -- Tenant isolation: mirrors only touch the tenant being written.
  if (select purchase_points_rate from public.tenants where id = c) <> 2.2575
     or (select (config->>'purchase_points_rate')::numeric from public.tenant_feature_settings where tenant_id = c and feature_key = 'loyalty') <> 2.2575
    then raise exception 'Another tenant was modified'; end if;

  -- New tenants get their loyalty row automatically (disabled by default).
  insert into public.tenants (id, slug, name) values (d, 'tenant-d', 'Tenant D');
  if not exists (select 1 from public.tenant_feature_settings where tenant_id = d and feature_key = 'loyalty' and not enabled
      and (config->>'purchase_points_rate')::numeric = 1.0)
    then raise exception 'New tenant must receive a disabled loyalty row'; end if;

  -- Config constraint, scoped to loyalty.
  begin
    update public.tenant_feature_settings set config = '{"purchase_points_rate": -1}' where tenant_id = a and feature_key = 'loyalty';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"purchase_points_rate": 1.23456}' where tenant_id = a and feature_key = 'loyalty';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"purchase_points_rate": "2"}' where tenant_id = a and feature_key = 'loyalty';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"api_key": "x"}' where tenant_id = a and feature_key = 'loyalty';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  update public.tenant_feature_settings set config = '{"purchase_points_rate": -1}' where tenant_id = a and feature_key = 'reviews';

  -- Privileges: loyalty values are server-only now; public branding unchanged.
  if has_column_privilege('anon', 'public.tenants', 'loyalty_enabled', 'select')
     or has_column_privilege('anon', 'public.tenants', 'purchase_points_rate', 'select')
     or has_column_privilege('authenticated', 'public.tenants', 'points_to_currency_rate', 'select')
    then raise exception 'Loyalty columns must not stay publicly readable'; end if;
  if not has_column_privilege('anon', 'public.tenants', 'name', 'select')
    then raise exception 'Public branding grants must be preserved'; end if;
  if has_table_privilege('anon', 'public.tenant_feature_settings', 'select')
    then raise exception 'Settings must stay server-only'; end if;
  if has_function_privilege('anon', 'public.is_valid_loyalty_config(jsonb)', 'execute')
    then raise exception 'Validator must not be public'; end if;
end $$;
rollback;
