begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  first_claim boolean;
begin
  -- Catalog: registered, non-billable, in no plan and without overrides.
  if not exists (
    select 1 from public.platform_features
    where key = 'daily_order_digest' and active and not billable and category = 'operations'
  ) then raise exception 'daily_order_digest must be an active, non-billable operational feature'; end if;
  if exists (select 1 from public.platform_plan_features where feature_key = 'daily_order_digest')
    then raise exception 'daily_order_digest must not be granted by any plan'; end if;
  if exists (select 1 from public.tenant_feature_overrides where feature_key = 'daily_order_digest')
    then raise exception 'daily_order_digest must not create commercial overrides'; end if;

  -- No tenants.daily_digest_* columns and no automatic activation.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenants' and column_name like 'daily\_digest\_%'
  ) then raise exception 'Migration 129 must not add tenants.daily_digest_* columns'; end if;
  if exists (select 1 from public.tenant_feature_settings where feature_key = 'daily_order_digest')
    then raise exception 'Migration 129 must not create or enable digest settings'; end if;

  -- Existing module settings (Nala from 096, reviews JSONB) are byte-identical.
  if exists (
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public._fixture_settings_before)
    except
    (select tenant_id, feature_key, enabled, config, created_at, updated_at from public.tenant_feature_settings)
  ) or (select count(*) from public.tenant_feature_settings) <> (select count(*) from public._fixture_settings_before)
    then raise exception 'Existing tenant_feature_settings rows were modified'; end if;
  if (select enabled from public.tenant_feature_settings where tenant_id = a and feature_key = 'nala') is not true
     or (select enabled from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala') is not false
     or (select config from public.tenant_feature_settings where tenant_id = b and feature_key = 'nala') <> '{"tone": "warm"}'::jsonb
    then raise exception 'Nala operational settings were not preserved'; end if;

  -- Recipient opt-in exists and defaults off for existing recipients.
  if exists (select 1 from public.tenant_notification_recipients where notify_daily_digest)
    then raise exception 'Existing recipients must not be opted in'; end if;

  -- Config constraint: valid partial/full configs accepted, invalid rejected.
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (a, 'daily_order_digest', false, '{"version": 1, "timezone": "Europe/Rome", "include_empty": false, "prepare_hours": 24, "pickup_hours": 48, "payment_verification_hours": 48, "tracking_stale_hours": 72}');
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled)
  values (b, 'daily_order_digest', false);
  if (select enabled from public.tenant_feature_settings where tenant_id = b and feature_key = 'daily_order_digest') <> false
    then raise exception 'Explicit disabled row expected'; end if;

  begin
    update public.tenant_feature_settings set config = '{"prepare_hours": 0}' where tenant_id = a and feature_key = 'daily_order_digest';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"tracking_stale_hours": 12}' where tenant_id = a and feature_key = 'daily_order_digest';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"prepare_hours": "24"}' where tenant_id = a and feature_key = 'daily_order_digest';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"smtp_password": "x"}' where tenant_id = a and feature_key = 'daily_order_digest';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '[]' where tenant_id = a and feature_key = 'daily_order_digest';
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  -- The constraint is scoped: other modules keep free-form config.
  update public.tenant_feature_settings set config = '{"prepare_hours": 0}' where tenant_id = a and feature_key = 'reviews';

  -- Privileges: nothing readable or callable by browser roles.
  if has_table_privilege('anon', 'public.tenant_feature_settings', 'select')
     or has_table_privilege('authenticated', 'public.tenant_feature_settings', 'select')
     or has_table_privilege('anon', 'public.tenant_daily_digest_runs', 'select')
     or has_table_privilege('authenticated', 'public.tenant_daily_digest_runs', 'insert')
     or has_table_privilege('authenticated', 'public.tenant_daily_digest_runs', 'update')
    then raise exception 'Browser roles must not access digest settings or runs'; end if;
  if has_function_privilege('anon', 'public.claim_tenant_daily_digest(uuid,date)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_tenant_daily_digest(uuid,date)', 'execute')
    then raise exception 'Claim RPC must be service-role only'; end if;
  if not has_function_privilege('service_role', 'public.claim_tenant_daily_digest(uuid,date)', 'execute')
     or not has_function_privilege('service_role', 'public.is_valid_daily_digest_config(jsonb)', 'execute')
     or not has_table_privilege('service_role', 'public.tenant_daily_digest_runs', 'update')
    then raise exception 'service_role must keep server-side access'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.tenant_daily_digest_runs'::regclass)
    then raise exception 'RLS must be enabled on runs'; end if;

  -- Idempotent claim per tenant and local date.
  first_claim := public.claim_tenant_daily_digest(a, date '2026-09-26');
  if not first_claim then raise exception 'First claim must succeed'; end if;
  if public.claim_tenant_daily_digest(a, date '2026-09-26') then raise exception 'Concurrent claim must fail'; end if;
  if not public.claim_tenant_daily_digest(b, date '2026-09-26') then raise exception 'Tenants are claimed independently'; end if;
  if not public.claim_tenant_daily_digest(a, date '2026-09-27') then raise exception 'Next day is claimed independently'; end if;

  update public.tenant_daily_digest_runs set status = 'accepted' where tenant_id = a and local_date = '2026-09-26';
  if public.claim_tenant_daily_digest(a, date '2026-09-26') then raise exception 'Accepted run must never be re-sent'; end if;

  update public.tenant_daily_digest_runs set status = 'skipped' where tenant_id = b and local_date = '2026-09-26';
  if public.claim_tenant_daily_digest(b, date '2026-09-26') then raise exception 'Skipped run must not be re-claimed'; end if;

  update public.tenant_daily_digest_runs set status = 'failed', error_code = 'n8n_not_accepted' where tenant_id = a and local_date = '2026-09-27';
  if not public.claim_tenant_daily_digest(a, date '2026-09-27') then raise exception 'Failed run must be retryable'; end if;
  if (select error_code from public.tenant_daily_digest_runs where tenant_id = a and local_date = '2026-09-27') is not null
    then raise exception 'Retry must clear error_code'; end if;

  update public.tenant_daily_digest_runs set claimed_at = now() - interval '31 minutes' where tenant_id = a and local_date = '2026-09-27';
  if not public.claim_tenant_daily_digest(a, date '2026-09-27') then raise exception 'Abandoned processing lease must be recoverable'; end if;
end $$;
rollback;
