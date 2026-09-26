begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  d constant uuid := '44444444-4444-4444-8444-444444444444';
  customer_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  customer_b constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  staff constant uuid := 'cccccccc-0000-4000-8000-00000000000c';
  awarded int;
  balance int;
begin
  -- Legacy columns, mirror triggers and trigger functions are gone.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants'
      and column_name in ('loyalty_enabled', 'purchase_points_rate', 'points_to_currency_rate'))
    then raise exception 'Legacy loyalty columns must be dropped'; end if;
  if exists (select 1 from pg_trigger where tgname in ('tenant_feature_settings_loyalty_sync', 'tenants_loyalty_settings_sync'))
     or exists (select 1 from pg_proc where proname in ('sync_loyalty_settings_to_tenant', 'sync_tenant_loyalty_to_settings'))
    then raise exception 'Mirror triggers must be removed'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenants'
      and column_name = 'referral_signup_bonus_points')
    then raise exception 'Referral columns must be kept'; end if;

  -- Settings rows and points history are preserved exactly.
  if exists ((select tenant_id, enabled, config from public._fixture_loyalty_before)
             except (select tenant_id, enabled, config from public.tenant_feature_settings where feature_key = 'loyalty'))
    then raise exception 'Loyalty settings changed'; end if;
  if exists ((select * from public._fixture_ledger_before) except (select * from public.points_ledger))
    then raise exception 'Existing points history changed'; end if;
  if exists (
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public._fixture_settings_before)
    except
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public.tenant_feature_settings)
  ) then raise exception 'Other modules changed'; end if;

  -- In-store RPC now reads the settings row: same result as before (rate 1.5).
  select points_awarded, new_confirmed_balance into awarded, balance
  from process_manual_purchase_points_atomic(a, customer_a, staff, 10);
  if awarded <> 15 or balance <> 30 then
    raise exception 'Unexpected in-store points (awarded %, balance %)', awarded, balance;
  end if;

  -- A settings change is used immediately, per tenant.
  update public.tenant_feature_settings set config = config || '{"purchase_points_rate": 2}'
  where tenant_id = a and feature_key = 'loyalty';
  select points_awarded into awarded from process_manual_purchase_points_atomic(a, customer_a, staff, 10);
  if awarded <> 20 then raise exception 'Settings rate not used (awarded %)', awarded; end if;
  select points_awarded into awarded from process_manual_purchase_points_atomic(b, customer_b, staff, 10);
  if awarded <> 10 then raise exception 'Tenant B must keep its own rate (awarded %)', awarded; end if;

  -- New tenants get no automatic row: the RPC refuses instead of guessing a rate.
  insert into public.tenants (id, slug, name) values (d, 'tenant-d', 'Tenant D');
  if exists (select 1 from public.tenant_feature_settings where tenant_id = d)
    then raise exception 'No automatic loyalty row expected after 131'; end if;
  begin
    perform process_manual_purchase_points_atomic(d, customer_a, staff, 10);
    raise exception 'rpc_should_fail';
  exception when raise_exception then
    if sqlerrm = 'rpc_should_fail' then raise; end if;
  end;

  if not has_function_privilege('service_role', 'process_manual_purchase_points_atomic(uuid,uuid,uuid,numeric)', 'execute')
    then raise exception 'service_role must keep EXECUTE on the in-store RPC'; end if;
end $$;
rollback;
