begin;
do $$
begin
  if (select count(*) from public.tenant_feature_settings where feature_key = 'daily_order_digest') <> 2
    then raise exception 'Only customized legacy tenants must be backfilled'; end if;

  if not exists (
    select 1 from public.tenant_feature_settings
    where tenant_id = '11111111-1111-4111-8111-111111111111' and feature_key = 'daily_order_digest'
      and enabled
      and config = '{"version": 1, "timezone": "Europe/Paris", "include_empty": false, "prepare_hours": 12, "pickup_hours": 48, "payment_verification_hours": 48, "tracking_stale_hours": 96}'::jsonb
  ) then raise exception 'Enabled legacy tenant not backfilled verbatim'; end if;

  if not exists (
    select 1 from public.tenant_feature_settings
    where tenant_id = '22222222-2222-4222-8222-222222222222' and feature_key = 'daily_order_digest'
      and not enabled and config->>'include_empty' = 'true'
  ) then raise exception 'Disabled legacy tenant must stay disabled'; end if;

  if exists (select 1 from public.tenant_feature_settings where tenant_id = '33333333-3333-4333-8333-333333333333' and feature_key = 'daily_order_digest')
    then raise exception 'Default legacy tenant must not get a row'; end if;

  -- Compatibility: legacy columns are kept (no destructive step in this phase) but private.
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants' and column_name like 'daily\_digest\_%') <> 7
    then raise exception 'Legacy columns must be kept until a later verified cleanup'; end if;
  if has_column_privilege('anon', 'public.tenants', 'daily_digest_enabled', 'select')
     or has_column_privilege('anon', 'public.tenants', 'daily_digest_timezone', 'select')
    then raise exception 'Legacy digest columns must not stay publicly readable'; end if;

  -- Other modules untouched.
  if exists (
    (select tenant_id, feature_key, enabled, config, updated_at from public._fixture_settings_before)
    except
    (select tenant_id, feature_key, enabled, config, updated_at from public.tenant_feature_settings)
  ) then raise exception 'Existing module settings were modified by the backfill'; end if;
end $$;
rollback;
