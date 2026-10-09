-- Runs on the 151 fixture after 151 then 152 (twice).
begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
begin
  -- New key accepted together with every 151 key.
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (a, 'shipping_automation', true, '{"version": 1, "create_shipment_trigger": "preparing", "shipment_content": "Alimenti Non Deperibili"}');

  -- 151 configs (without the new key) remain valid.
  update public.tenant_feature_settings set config = '{"create_shipment_trigger": "manual"}'
    where tenant_id = a and feature_key = 'shipping_automation';

  begin
    update public.tenant_feature_settings set config = '{"shipment_content": "   "}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'blank content accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = jsonb_build_object('shipment_content', repeat('x', 61))
      where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'content longer than 60 accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"shipment_content": 12}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'non-string content accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"create_shipment_trigger": "shipped"}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'unknown trigger accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"unknown": true}' where tenant_id = a and feature_key = 'shipping_automation';
    raise exception 'unknown key accepted';
  exception when check_violation then null; end;

  if has_function_privilege('anon', 'public.is_valid_shipping_automation_config(jsonb)', 'execute')
    then raise exception 'validation function must not be executable by anon'; end if;
end $$;
rollback;
