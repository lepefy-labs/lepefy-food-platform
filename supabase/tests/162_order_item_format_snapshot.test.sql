-- 162: format captured at insert from the same-tenant product, never from
-- another tenant, a renamed product or a product without format; immutable;
-- never blocks an insert; prices untouched; no backfill of existing rows.
do $$
declare
  v_tenant uuid := '10000000-0000-4000-8000-000000000001';
  v_order uuid := '30000000-0000-4000-8000-000000000001';
  v_snapshot jsonb;
  v_id uuid;
begin
  -- Legacy row: no backfill by the migration.
  if exists (select 1 from public.order_items where order_id = '30000000-0000-4000-8000-000000000000' and format_snapshot is not null) then
    raise exception 'legacy row backfilled by the migration';
  end if;

  set local role service_role;

  -- Structured format (154) captured, weight_grams ignored, price untouched.
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000001', 'Kaolin', 4.5, 2, 9) returning id, format_snapshot into v_id, v_snapshot;
  if v_snapshot is distinct from '{"v": 1, "sale_unit": "sachet", "net_content_value": 150, "net_content_unit": "g"}'::jsonb then
    raise exception 'structured snapshot not captured: %', v_snapshot;
  end if;
  if (select price from public.order_items where id = v_id) <> 4.5 or (select subtotal from public.order_items where id = v_id) <> 9 then
    raise exception 'price changed by the trigger';
  end if;

  -- Free net quantity (018) captured.
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000002', 'Bissap', 3, 1, 3) returning format_snapshot into v_snapshot;
  if v_snapshot is distinct from '{"v": 1, "net_quantity_display": "500 ml"}'::jsonb then
    raise exception 'net quantity snapshot not captured: %', v_snapshot;
  end if;

  -- Pack captured.
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000005', 'Malta', 18, 1, 18) returning format_snapshot into v_snapshot;
  if v_snapshot->>'pack_count' <> '12' or v_snapshot->>'net_content_unit' <> 'cl' then
    raise exception 'pack snapshot not captured: %', v_snapshot;
  end if;

  -- No format on the product → null (weight_grams is never a format).
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000003', 'Mitoumba', 3, 1, 3) returning format_snapshot into v_snapshot;
  if v_snapshot is not null then raise exception 'snapshot invented without format: %', v_snapshot; end if;

  -- Product renamed between cart and order → null (no uncertain inference).
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000001', 'Kaolin (ancien nom)', 4.5, 1, 4.5) returning format_snapshot into v_snapshot;
  if v_snapshot is not null then raise exception 'snapshot taken for a renamed product'; end if;

  -- Product of another tenant → null (tenant isolation).
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000004', 'Kaolin', 4.5, 1, 4.5) returning format_snapshot into v_snapshot;
  if v_snapshot is not null then raise exception 'snapshot read across tenants'; end if;

  -- No product (deleted) → the insert still works.
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values (v_order, v_tenant, null, 'Article libre', 2, 1, 2) returning format_snapshot into v_snapshot;
  if v_snapshot is not null then raise exception 'snapshot without product'; end if;

  -- An explicit snapshot provided by the writer is kept as is.
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal, format_snapshot)
  values (v_order, v_tenant, '40000000-0000-4000-8000-000000000001', 'Kaolin', 4.5, 1, 4.5, '{"v": 1, "net_quantity_display": "1 kg"}')
  returning format_snapshot into v_snapshot;
  if v_snapshot->>'net_quantity_display' <> '1 kg' then raise exception 'explicit snapshot overwritten'; end if;

  -- Product edited after the purchase: the order line keeps the old format.
  reset role;
  update public.products set net_content_value = 250 where id = '40000000-0000-4000-8000-000000000001';
  set local role service_role;
  if (select (format_snapshot->>'net_content_value')::numeric from public.order_items where id = v_id) <> 150 then
    raise exception 'snapshot followed the catalogue';
  end if;

  -- Immutable: no change, no erase; other columns stay updatable.
  begin
    update public.order_items set format_snapshot = '{"v": 1, "net_quantity_display": "2 kg"}' where id = v_id;
    raise exception 'snapshot modified';
  exception when check_violation then null;
  end;
  begin
    update public.order_items set format_snapshot = null where id = v_id;
    raise exception 'snapshot erased';
  exception when check_violation then null;
  end;
  update public.order_items set picked_at = now() where id = v_id;
  -- No later backfill: a legacy row cannot receive a snapshot.
  begin
    update public.order_items set format_snapshot = '{"v": 1, "net_quantity_display": "500 g"}'
     where order_id = '30000000-0000-4000-8000-000000000000';
    raise exception 'legacy row backfilled';
  exception when check_violation then null;
  end;
  reset role;

  -- The capture function cannot be called by API roles.
  if has_function_privilege('anon', 'public.order_items_capture_format_snapshot()', 'execute')
     or has_function_privilege('authenticated', 'public.order_items_capture_format_snapshot()', 'execute') then
    raise exception 'capture function exposed';
  end if;
end $$;

select '162 order item format snapshot: ok' as result;
