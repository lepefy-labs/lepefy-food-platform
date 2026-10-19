-- 160: configuration validated by the CHECK, mode snapshot validated on
-- orders, existing orders untouched, audit events for the paper flow.
do $$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000001';
  v_order uuid := '30000000-0000-4000-8000-000000000001';
  v_admin uuid := '20000000-0000-4000-8000-000000000001';
  v_count integer;
begin
  -- Module registered once, no tenant row created, existing orders untouched.
  select count(*) into v_count from public.platform_features where key = 'order_preparation';
  if v_count <> 1 then raise exception 'module not registered (%)', v_count; end if;
  select count(*) into v_count from public.tenant_feature_settings;
  if v_count <> 0 then raise exception 'migration must not create tenant rows'; end if;
  select count(*) into v_count from public.orders where preparation_mode is not null or picking_list_printed_at is not null;
  if v_count <> 0 then raise exception 'existing orders must keep a null snapshot'; end if;

  -- Valid and partial configurations are accepted.
  insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
  values (v_tenant, 'order_preparation', true, '{"version":1,"picking_mode":"paper","cold_chain_packing_mode":"digital"}');
  update public.tenant_feature_settings set config = '{"picking_mode":"none"}' where feature_key = 'order_preparation';

  -- Unknown values and keys are refused.
  begin
    update public.tenant_feature_settings set config = '{"picking_mode":"automatic"}' where feature_key = 'order_preparation';
    raise exception 'unknown mode accepted';
  exception when check_violation then null;
  end;
  begin
    update public.tenant_feature_settings set config = '{"picking_mode":"paper","skip_payment":true}' where feature_key = 'order_preparation';
    raise exception 'unknown key accepted';
  exception when check_violation then null;
  end;
  -- Other modules are not constrained by this CHECK.
  insert into public.tenant_feature_settings (tenant_id, feature_key, config) values (v_tenant, 'other_module', '{"anything":1}');

  -- Order snapshot shape.
  update public.orders set preparation_mode = '{"picking":"paper","cold_chain_packing":"paper"}' where id = v_order;
  begin
    update public.orders set preparation_mode = '{"picking":"paper"}' where id = v_order;
    raise exception 'incomplete snapshot accepted';
  exception when check_violation then null;
  end;
  begin
    update public.orders set preparation_mode = '{"picking":"paper","cold_chain_packing":"paper","extra":1}' where id = v_order;
    raise exception 'snapshot with extra key accepted';
  exception when check_violation then null;
  end;

  -- Audit: start, completion, withdrawal, unverified advance; unrelated updates emit nothing.
  update public.orders set picking_list_printed_at = now(), paper_preparation_started_at = now(), paper_preparation_started_by = v_admin where id = v_order;
  update public.orders set packing_parcel_count = 2 where id = v_order;
  update public.orders set paper_preparation_completed_at = now(), paper_preparation_completed_by = v_admin, cold_chain_packing_declared_at = now() where id = v_order;
  update public.orders set paper_preparation_completed_at = null, paper_preparation_completed_by = null where id = v_order;
  update public.orders set preparation_unverified_at = now(), status = 'shipped' where id = v_order;

  select count(*) into v_count from public.audit_events_test where event_type = 'orders.preparation.paper_started';
  if v_count <> 1 then raise exception 'paper_started events: %', v_count; end if;
  select count(*) into v_count from public.audit_events_test where event_type = 'orders.preparation.paper_completed' and not (metadata ? 'withdrawn');
  if v_count <> 1 then raise exception 'paper_completed events: %', v_count; end if;
  select count(*) into v_count from public.audit_events_test where event_type = 'orders.preparation.paper_completed' and (metadata->>'withdrawn')::boolean;
  if v_count <> 1 then raise exception 'withdrawal events: %', v_count; end if;
  select count(*) into v_count from public.audit_events_test where event_type = 'orders.preparation.unverified_advance';
  if v_count <> 1 then raise exception 'unverified events: %', v_count; end if;
  select count(*) into v_count from public.audit_events_test;
  if v_count <> 4 then raise exception 'unexpected audit events: %', v_count; end if;
  if not exists (select 1 from public.audit_events_test where event_type = 'orders.preparation.paper_completed' and (metadata->>'parcel_count')::int = 2 and (metadata->>'cold_chain_declared')::boolean) then
    raise exception 'completion metadata missing parcel count / cold declaration';
  end if;

  -- Event types are catalogued (FK target of audit_events in 153).
  select count(*) into v_count from public.audit_event_types where key like 'orders.preparation.%';
  if v_count <> 3 then raise exception 'audit event types: %', v_count; end if;

  -- Writers only through the service role: the validator is not executable by clients.
  if has_function_privilege('anon', 'public.is_valid_order_preparation_config(jsonb)', 'execute') then
    raise exception 'anon can execute the validator';
  end if;
  raise notice '160 order preparation modes: ok';
end $$;
