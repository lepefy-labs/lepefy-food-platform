-- 180: packaging weight bands — no activation, atomic full replacement, tenant isolation, privileges.
do $$
declare
  v_a uuid := '11111111-1111-4111-8111-111111111111';
  v_b uuid := '22222222-2222-4222-8222-222222222222';
  v_valid jsonb := '[
    {"min_weight_g_exclusive":0,"max_weight_g_inclusive":5000,"added_weight_g":500},
    {"min_weight_g_exclusive":5000,"max_weight_g_inclusive":10000,"added_weight_g":1000},
    {"min_weight_g_exclusive":10000,"max_weight_g_inclusive":20000,"added_weight_g":1500},
    {"min_weight_g_exclusive":20000,"max_weight_g_inclusive":null,"added_weight_g":2000}
  ]';
  v_bad jsonb;
begin
  if exists (select 1 from public.shipping_packaging_weight_bands) then raise exception 'the migration must not create bands'; end if;
  if not exists (select 1 from public.audit_event_types where key = 'shipping.packaging_weight.updated') then raise exception 'audit type missing'; end if;

  if public.replace_shipping_packaging_weight_bands(v_a, v_valid, null) <> 4 then raise exception 'wrong count'; end if;
  if (select count(*) from public.shipping_packaging_weight_bands where tenant_id = v_a) <> 4 then raise exception 'bands not stored'; end if;
  perform public.replace_shipping_packaging_weight_bands(v_b, '[{"min_weight_g_exclusive":0,"max_weight_g_inclusive":null,"added_weight_g":300}]', null);

  -- Each invalid list must leave the current bands untouched.
  foreach v_bad in array array[
    '[{"min_weight_g_exclusive":100,"max_weight_g_inclusive":null,"added_weight_g":1}]'::jsonb,
    '[{"min_weight_g_exclusive":0,"max_weight_g_inclusive":5000,"added_weight_g":1}]'::jsonb,
    '[{"min_weight_g_exclusive":0,"max_weight_g_inclusive":null,"added_weight_g":1},{"min_weight_g_exclusive":0,"max_weight_g_inclusive":null,"added_weight_g":1}]'::jsonb,
    '[{"min_weight_g_exclusive":0,"max_weight_g_inclusive":5000,"added_weight_g":1},{"min_weight_g_exclusive":6000,"max_weight_g_inclusive":null,"added_weight_g":1}]'::jsonb,
    '[{"min_weight_g_exclusive":0,"max_weight_g_inclusive":null,"added_weight_g":20001}]'::jsonb,
    '{}'::jsonb
  ] loop
    begin
      perform public.replace_shipping_packaging_weight_bands(v_a, v_bad, null);
      raise exception 'invalid list accepted: %', v_bad;
    exception when raise_exception then
      if sqlerrm <> 'invalid_packaging_weight_bands' then raise; end if;
    end;
  end loop;
  if (select count(*) from public.shipping_packaging_weight_bands where tenant_id = v_a) <> 4 then raise exception 'invalid list changed the bands'; end if;

  begin
    perform public.replace_shipping_packaging_weight_bands('33333333-3333-4333-8333-333333333333', '[]', null);
    raise exception 'unknown tenant accepted';
  exception when raise_exception then
    if sqlerrm <> 'tenant_not_found' then raise; end if;
  end;

  -- An empty list turns the feature off for that tenant only.
  perform public.replace_shipping_packaging_weight_bands(v_a, '[]', null);
  if exists (select 1 from public.shipping_packaging_weight_bands where tenant_id = v_a) then raise exception 'empty list must clear'; end if;
  if (select count(*) from public.shipping_packaging_weight_bands where tenant_id = v_b) <> 1 then raise exception 'other tenant touched'; end if;

  -- Privileges.
  if has_table_privilege('anon', 'public.shipping_packaging_weight_bands', 'select') then raise exception 'anon can read'; end if;
  if has_table_privilege('authenticated', 'public.shipping_packaging_weight_bands', 'select') then raise exception 'authenticated can read'; end if;
  if has_table_privilege('service_role', 'public.shipping_packaging_weight_bands', 'insert') then raise exception 'service_role must write through the RPC'; end if;
  if has_function_privilege('anon', 'public.replace_shipping_packaging_weight_bands(uuid, jsonb, uuid)', 'execute') then raise exception 'anon can execute'; end if;
  if has_function_privilege('authenticated', 'public.replace_shipping_packaging_weight_bands(uuid, jsonb, uuid)', 'execute') then raise exception 'authenticated can execute'; end if;
  if not has_function_privilege('service_role', 'public.replace_shipping_packaging_weight_bands(uuid, jsonb, uuid)', 'execute') then raise exception 'service_role cannot execute'; end if;
  if not (select relforcerowsecurity from pg_class where oid = 'public.shipping_packaging_weight_bands'::regclass) then raise exception 'RLS not forced'; end if;
end $$;
