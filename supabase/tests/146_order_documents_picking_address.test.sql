-- Runs on the 145 fixture after 145 then 146 (twice).
begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
begin
  -- New key accepted, together with every 145 key.
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (a, 'order_documents', true, '{"version": 1, "picking_list_format": "a5", "picking_list_show_delivery_address": true, "packing_slip_enabled": true, "packing_slip_format": "a4", "packing_slip_show_logo": true, "packing_slip_show_qr": true, "packing_slip_show_thank_you": true, "packing_slip_show_contact": true, "packing_slip_show_prices": false, "packing_slip_show_delivery_address": false}');

  -- 145 configs (without the new key) remain valid.
  update public.tenant_feature_settings set config = '{"picking_list_format": "a4"}' where tenant_id = a and feature_key = 'order_documents';

  begin
    update public.tenant_feature_settings set config = '{"picking_list_show_delivery_address": "yes"}' where tenant_id = a and feature_key = 'order_documents';
    raise exception 'non-boolean picking_list_show_delivery_address accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_feature_settings set config = '{"unknown": true}' where tenant_id = a and feature_key = 'order_documents';
    raise exception 'unknown key accepted';
  exception when check_violation then null; end;

  if has_function_privilege('anon', 'public.is_valid_order_documents_config(jsonb)', 'execute')
    then raise exception 'validation function must not be executable by anon'; end if;
end $$;
rollback;
