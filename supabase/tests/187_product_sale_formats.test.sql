-- 187: formats under one product, shared stock in base units, aggregated
-- atomic decrement, derived stock never written apart, order snapshot v2,
-- one catalogue row per product, tenant isolation, privileges.
do $$
declare
  t_a uuid := '11111111-1111-4111-8111-111111111111';
  t_b uuid := '22222222-2222-4222-8222-222222222222';
  v_legacy uuid := 'a0000000-0000-4000-8000-000000000001';
  v_ndole uuid := 'a0000000-0000-4000-8000-000000000002';
  v_other uuid := 'b0000000-0000-4000-8000-000000000001';
  v_lot uuid;
  v_own uuid;
  v_snapshot jsonb;
  v_failed boolean;
  r record;
begin
  set local role service_role;
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);

  -- ── Legacy product: identical behaviour ────────────────────────────────
  perform public.decrement_stock_for_order(jsonb_build_array(jsonb_build_object('product_id', v_legacy, 'quantity', 2)));
  if (select stock from public.products where id = v_legacy) <> 3 then raise exception 'legacy decrement changed'; end if;
  begin
    perform public.decrement_stock_for_order(jsonb_build_array(jsonb_build_object('product_id', v_legacy, 'quantity', 4)));
    raise exception 'legacy overdraw accepted';
  exception when others then
    if sqlerrm <> 'insufficient_stock:' || v_legacy then raise; end if;
  end;
  if (select stock from public.products where id = v_legacy) <> 3 then raise exception 'legacy partial decrement'; end if;
  -- Duplicate lines of the same product are summed, as before.
  begin
    perform public.decrement_stock_for_order(jsonb_build_array(
      jsonb_build_object('product_id', v_legacy, 'quantity', 2), jsonb_build_object('product_id', v_legacy, 'quantity', 2)));
    raise exception 'duplicate legacy lines overdraw accepted';
  exception when others then
    if sqlerrm not like 'insufficient_stock:%' then raise; end if;
  end;

  -- ── Create the lot through the RPC ─────────────────────────────────────
  select out_id into v_lot from public.set_product_sale_formats(t_a, v_ndole, '1 paquet',
    '[{"label": "Lot de 3 paquets", "units_per_sale": 3, "price": 9.90, "weight_grams": 1520, "slug": "ndole-lot-3"}]'::jsonb)
    where out_created;
  if v_lot is null then raise exception 'lot not created'; end if;
  select * into r from public.products where id = v_lot;
  if r.stock <> 2 or r.name <> 'Ndole — Lot de 3 paquets' or r.storage_type <> 'dry' or r.featured
     or r.tenant_id <> t_a or r.units_per_sale <> 3 or r.price <> 9.90 or r.weight_grams <> 1520
     or r.min_order_quantity <> 1 or r.category_id <> 'c0000000-0000-4000-8000-000000000001' then
    raise exception 'lot row wrong: %', to_jsonb(r);
  end if;
  if (select format_label from public.products where id = v_ndole) <> '1 paquet' then raise exception 'base label not set'; end if;

  -- ── Stock 7: 2 lots + 1 single accepted, consumes 7 packs ──────────────
  perform public.decrement_stock_for_order(jsonb_build_array(
    jsonb_build_object('product_id', v_lot, 'quantity', 2), jsonb_build_object('product_id', v_ndole, 'quantity', 1)));
  if (select stock from public.products where id = v_ndole) <> 0 or (select stock from public.products where id = v_lot) <> 0 then
    raise exception 'aggregated decrement wrong';
  end if;

  -- Restock the parent (Gestion / editor): the lot follows.
  update public.products set stock = 7 where id = v_ndole;
  if (select stock from public.products where id = v_lot) <> 2 then raise exception 'lot did not follow restock'; end if;

  -- ── Stock 7: 2 lots + 2 singles (8 packs) refused, nothing decremented ─
  v_failed := false;
  begin
    perform public.decrement_stock_for_order(jsonb_build_array(
      jsonb_build_object('product_id', v_lot, 'quantity', 2), jsonb_build_object('product_id', v_ndole, 'quantity', 2)));
  exception when others then
    v_failed := sqlerrm like 'insufficient_stock:%';
  end;
  if not v_failed then raise exception '8 packs on stock 7 accepted'; end if;
  if (select stock from public.products where id = v_ndole) <> 7 then raise exception 'partial decrement kept'; end if;

  -- ── Derived stock is never written apart ───────────────────────────────
  v_failed := false;
  begin
    update public.products set stock = 50 where id = v_lot;
  exception when others then
    v_failed := sqlerrm like 'format_stock_is_derived:%';
  end;
  if not v_failed then raise exception 'direct write of derived stock accepted'; end if;
  -- Writing the same value (whole-row editor save) and other fields is fine.
  update public.products set stock = 2, description = 'Lot' where id = v_lot;

  -- ── Inheritance and structure guards ───────────────────────────────────
  update public.products set name = 'Arachides (Ndole)', storage_type = 'fresh' where id = v_ndole;
  select * into r from public.products where id = v_lot;
  if r.name <> 'Arachides (Ndole) — Lot de 3 paquets' or r.storage_type <> 'fresh' then raise exception 'inheritance failed'; end if;
  update public.products set storage_type = 'dry' where id = v_ndole;

  v_failed := false;
  begin
    insert into public.products (tenant_id, name, slug, price, format_parent_id, units_per_sale, format_label)
    values (t_a, 'x', 'ndole-lot-lot', 1, v_lot, 2, 'Lot de lots');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'format of a format accepted'; end if;

  v_failed := false;
  begin
    insert into public.products (tenant_id, name, slug, price, format_parent_id, units_per_sale, format_label)
    values (t_b, 'x', 'vol', 1, v_ndole, 2, 'Lot');
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'cross-tenant format accepted'; end if;

  v_failed := false;
  begin
    perform public.set_product_sale_formats(t_b, v_ndole, '1 paquet', '[]'::jsonb);
  exception when others then v_failed := sqlerrm = 'format_parent_not_found';
  end;
  if not v_failed then raise exception 'RPC accepted another tenant product'; end if;

  v_failed := false;
  begin
    update public.products set units_per_sale = 2 where id = v_other;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'units_per_sale > 1 on a catalogue product accepted'; end if;

  -- ── Order snapshot v2 ──────────────────────────────────────────────────
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values ('30000000-0000-4000-8000-000000000001', t_a, v_lot, 'Arachides (Ndole) — Lot de 3 paquets', 9.90, 1, 9.90)
  returning format_snapshot into v_snapshot;
  if v_snapshot is distinct from jsonb_build_object('v', 2, 'format_label', 'Lot de 3 paquets', 'units_per_sale', 3,
      'stock_product_id', v_ndole, 'sale_unit', 'paquet', 'net_quantity_display', '500 g') then
    raise exception 'lot snapshot wrong: %', v_snapshot;
  end if;
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values ('30000000-0000-4000-8000-000000000001', t_a, v_ndole, 'Arachides (Ndole)', 3.50, 1, 3.50)
  returning format_snapshot into v_snapshot;
  if v_snapshot is distinct from '{"v": 2, "format_label": "1 paquet", "units_per_sale": 1, "sale_unit": "paquet", "net_quantity_display": "500 g"}'::jsonb then
    raise exception 'base snapshot wrong: %', v_snapshot;
  end if;
  insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
  values ('30000000-0000-4000-8000-000000000001', t_a, v_legacy, 'Piment', 2.90, 1, 2.90)
  returning format_snapshot into v_snapshot;
  if v_snapshot is not null then raise exception 'legacy product without format got a snapshot: %', v_snapshot; end if;

  -- ── Price of a format in promotion is not changed by the RPC ───────────
  update public.products set compare_at_price = 10.50 where id = v_lot;
  v_failed := false;
  begin
    perform public.set_product_sale_formats(t_a, v_ndole, '1 paquet', jsonb_build_array(jsonb_build_object(
      'id', v_lot, 'label', 'Lot de 3 paquets', 'units_per_sale', 3, 'price', 9.50, 'weight_grams', 1520)));
  exception when others then v_failed := sqlerrm = 'format_price_promotion_active';
  end;
  if not v_failed then raise exception 'promo price overwritten'; end if;
  update public.products set compare_at_price = null where id = v_lot;

  -- ── Own stock (separate cartons) ───────────────────────────────────────
  select out_id into v_own from public.set_product_sale_formats(t_a, v_ndole, '1 paquet', jsonb_build_array(
    jsonb_build_object('id', v_lot, 'label', 'Lot de 3 paquets', 'units_per_sale', 3, 'price', 9.90, 'weight_grams', 1520),
    jsonb_build_object('label', 'Carton de 12', 'units_per_sale', 12, 'price', 36, 'weight_grams', 6100,
      'slug', 'ndole-carton-12', 'stock_mode', 'own')))
    where out_created;
  update public.products set stock = 4 where id = v_own;
  perform public.decrement_stock_for_order(jsonb_build_array(jsonb_build_object('product_id', v_own, 'quantity', 1)));
  if (select stock from public.products where id = v_own) <> 3 or (select stock from public.products where id = v_ndole) <> 7 then
    raise exception 'own stock decrement wrong';
  end if;

  -- ── One catalogue row per product ──────────────────────────────────────
  if exists (select 1 from public.catalog_ranked_product_ids(t_a) x where x.product_id in (v_lot, v_own)) then
    raise exception 'a format is listed in the catalogue';
  end if;
  if not exists (select 1 from public.catalog_ranked_product_ids(t_a) x where x.product_id = v_ndole) then
    raise exception 'canonical product missing from the catalogue';
  end if;

  -- ── Computed relationship: active formats of a product, same tenant ───
  if (select count(*) from public.sale_formats((select p from public.products p where p.id = v_ndole))) <> 2 then
    raise exception 'sale_formats wrong';
  end if;

  -- ── Removing formats: out of sale, never deleted ───────────────────────
  perform public.set_product_sale_formats(t_a, v_ndole, '', '[]'::jsonb);
  if exists (select 1 from public.products where format_parent_id = v_ndole and active) then raise exception 'format still on sale'; end if;
  if (select count(*) from public.products where format_parent_id = v_ndole) <> 2 then raise exception 'format deleted'; end if;
  if (select format_label from public.products where id = v_ndole) is not null then raise exception 'base label kept'; end if;

  reset role;
end $$;

-- Privileges: only the service role writes formats.
do $$
begin
  if has_function_privilege('anon', 'public.set_product_sale_formats(uuid, uuid, text, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.set_product_sale_formats(uuid, uuid, text, jsonb)', 'execute') then
    raise exception 'set_product_sale_formats callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.set_product_sale_formats(uuid, uuid, text, jsonb)', 'execute') then
    raise exception 'service role cannot write formats';
  end if;
end $$;
