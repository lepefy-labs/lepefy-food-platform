-- Runs on the 151 fixture after 151 (twice).
begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  existing constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  attached constant uuid := 'aaaaaaaa-0000-4000-8000-000000000002';
begin
  -- Catalog row registered once, non-billable; no tenant enabled by the migration.
  if (select count(*) from public.platform_features where key = 'shipping_automation' and billable = false) <> 1
    then raise exception 'shipping_automation must be registered once, non-billable'; end if;
  if exists (select 1 from public.tenant_feature_settings where feature_key = 'shipping_automation')
    then raise exception 'migration must not enable any tenant'; end if;

  -- Existing orders untouched: not_required (null), zero attempts, reference kept.
  if exists (select 1 from public.orders where shipping_creation_status is not null or shipping_creation_attempts <> 0
      or shipping_creation_error is not null or shipping_provider_created_at is not null)
    then raise exception 'existing orders must keep empty provisioning state'; end if;
  if (select shipping_provider_reference from public.orders where id = attached) <> 'IT2026PRO0000000001'
    then raise exception 'existing reference changed'; end if;

  -- Valid settings and every provisioning status.
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (a, 'shipping_automation', true, '{"version": 1, "create_shipment_trigger": "preparing"}');
  update public.tenant_feature_settings set config = '{"create_shipment_trigger": "order_created"}'
    where tenant_id = a and feature_key = 'shipping_automation';
  update public.tenant_feature_settings set config = '{}' where tenant_id = a and feature_key = 'shipping_automation';
  update public.orders set shipping_creation_status = 'not_required' where id = existing;
  update public.orders set shipping_creation_status = 'pending' where id = existing;
  update public.orders set shipping_creation_status = 'creating', shipping_creation_attempts = 1, shipping_creation_updated_at = now() where id = existing;
  update public.orders set shipping_creation_status = 'failed', shipping_creation_error = 'invalid_recipient:téléphone' where id = existing;
  update public.orders set shipping_creation_status = 'ambiguous', shipping_creation_error = 'provider_timeout' where id = existing;
  update public.orders set shipping_creation_status = 'draft_created', shipping_creation_error = null,
    shipping_provider_created_at = now(), shipping_tracking_mode = 'managed', shipping_provider_key = 'packlink',
    shipping_provider_reference = 'IT2026PRO0006415025' where id = existing;

  -- Invalid values rejected.
  begin
    update public.tenant_feature_settings set config = '{"create_shipment_trigger": "shipped"}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'unknown trigger accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"api_key": "secret"}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'unknown key accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"version": 2}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'unknown version accepted';
  exception when check_violation then null; end;
  begin
    update public.orders set shipping_creation_status = 'purchased' where id = existing;
    raise exception 'unknown provisioning status accepted';
  exception when check_violation then null; end;
  begin
    update public.orders set shipping_creation_attempts = -1 where id = existing;
    raise exception 'negative attempts accepted';
  exception when check_violation then null; end;
  begin
    update public.orders set shipping_creation_error = repeat('x', 65) where id = existing;
    raise exception 'unbounded error accepted';
  exception when check_violation then null; end;

  -- One reference cannot be attached to two orders of the tenant (111 index kept).
  begin
    update public.orders set shipping_provider_reference = 'IT2026PRO0006415025' where id = attached;
    raise exception 'duplicate provider reference accepted';
  exception when unique_violation then null; end;

  -- Other modules unaffected by the new CHECK.
  insert into public.platform_features (key, name, category) values ('other_module', 'Other', 'operations');
  insert into public.tenant_feature_settings (tenant_id, feature_key, config) values (a, 'other_module', '{"anything": true}');

  if has_function_privilege('anon', 'public.is_valid_shipping_automation_config(jsonb)', 'execute')
    then raise exception 'validation function must not be executable by anon'; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_shipping_creation_queue_idx')
    then raise exception 'queue index missing'; end if;
end $$;
rollback;
