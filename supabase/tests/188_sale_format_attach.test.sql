-- 188: attach an existing product as a sale format (same id, own stock,
-- price and promotion kept, inheritance by the 187 trigger), refusals,
-- detach of an own-stock format, tenant isolation, privileges.
do $$
declare
  t_a uuid := '11111111-1111-4111-8111-111111111111';
  v_piment uuid := 'a0000000-0000-4000-8000-000000000001';
  v_ndole uuid := 'a0000000-0000-4000-8000-000000000002';
  v_other uuid := 'b0000000-0000-4000-8000-000000000001';
  v_carton uuid := 'a0000000-0000-4000-8000-000000000010';
  v_empty uuid := 'a0000000-0000-4000-8000-000000000011';
  r record;
begin
  set local role service_role;
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);

  -- ── Attach the carton (own stock) ─────────────────────────────────────
  if (select out_id from public.attach_product_as_sale_format(t_a, v_ndole, v_carton, 'Carton de 10', 10, 'own', '1 paquet')) <> v_carton then
    raise exception 'attach did not return the same id';
  end if;
  select * into r from public.products where id = v_carton;
  if r.format_parent_id <> v_ndole or r.units_per_sale <> 10 or r.format_label <> 'Carton de 10'
     or r.format_stock_mode <> 'own' or r.stock <> 40 or r.price <> 25.00 or r.compare_at_price <> 30.00
     or r.name <> 'Ndole — Carton de 10' or r.storage_type <> 'dry'
     or r.category_id <> 'c0000000-0000-4000-8000-000000000001' or r.featured
     or r.min_order_quantity <> 1 or r.order_quantity_step <> 1 or r.add_on_position is not null
     or r.format_position <> 1 or r.slug <> 'ndole-carton-10' then
    raise exception 'attached carton wrong: %', to_jsonb(r);
  end if;
  if (select format_label from public.products where id = v_ndole) <> '1 paquet' then raise exception 'base label not set'; end if;
  if (select stock from public.products where id = v_ndole) <> 7 then raise exception 'parent stock touched'; end if;

  -- Own stock stays separate.
  perform public.decrement_stock_for_order(jsonb_build_array(jsonb_build_object('product_id', v_carton, 'quantity', 1)));
  if (select stock from public.products where id = v_carton) <> 39 or (select stock from public.products where id = v_ndole) <> 7 then
    raise exception 'own stock decrement wrong after attach';
  end if;

  -- ── Shared stock only without own stock ───────────────────────────────
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_piment, 'Lot de 2', 2, 'shared', null);
    raise exception 'shared attach with stock accepted';
  exception when others then
    if sqlerrm <> 'format_attach_stock_not_empty' then raise; end if;
  end;
  perform public.attach_product_as_sale_format(t_a, v_ndole, v_empty, 'Lot de 3', 3, 'shared', null);
  select * into r from public.products where id = v_empty;
  if r.stock <> 2 or r.format_position <> 2 or r.format_stock_mode <> 'shared' then
    raise exception 'shared attach wrong: %', to_jsonb(r);
  end if;
  update public.products set stock = 12 where id = v_ndole;
  if (select stock from public.products where id = v_empty) <> 4 then raise exception 'shared stock not derived after attach'; end if;

  -- ── Refusals ──────────────────────────────────────────────────────────
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_carton, 'Autre', 5, 'own', null);
    raise exception 'double attach accepted';
  exception when others then if sqlerrm <> 'format_attach_already_format' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_piment, 'carton DE 10', 4, 'own', null);
    raise exception 'duplicate label accepted';
  exception when others then if sqlerrm <> 'format_label_duplicate' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_piment, '1 PAQUET', 4, 'own', null);
    raise exception 'base label duplicate accepted';
  exception when others then if sqlerrm <> 'format_label_duplicate' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_ndole, 'Moi', 2, 'own', null);
    raise exception 'self attach accepted';
  exception when others then if sqlerrm <> 'format_attach_self' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_carton, v_piment, 'Sous-format', 2, 'own', '1 carton');
    raise exception 'attach under a format accepted';
  exception when others then if sqlerrm <> 'format_parent_not_found' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_piment, v_ndole, 'Lot', 2, 'own', '1 sachet');
    raise exception 'product with formats attached';
  exception when others then if sqlerrm <> 'format_has_formats' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_other, 'Autre boutique', 2, 'own', null);
    raise exception 'other tenant product attached';
  exception when others then if sqlerrm <> 'format_attach_not_found' then raise; end if;
  end;
  begin
    perform public.attach_product_as_sale_format(t_a, v_ndole, v_piment, 'Lot', 1, 'own', null);
    raise exception 'units 1 accepted';
  exception when others then if sqlerrm <> 'format_units_invalid' then raise; end if;
  end;
  if (select format_parent_id from public.products where id = v_piment) is not null then raise exception 'refused attach wrote'; end if;

  -- ── Detach ────────────────────────────────────────────────────────────
  begin
    perform public.detach_product_sale_format(t_a, v_empty);
    raise exception 'shared detach accepted';
  exception when others then if sqlerrm <> 'format_detach_shared' then raise; end if;
  end;
  begin
    perform public.detach_product_sale_format(t_a, v_piment);
    raise exception 'detach of a plain product accepted';
  exception when others then if sqlerrm <> 'format_detach_not_format' then raise; end if;
  end;
  select * into r from public.detach_product_sale_format(t_a, v_carton);
  if r.out_id <> v_carton or r.out_parent_id <> v_ndole then raise exception 'detach result wrong'; end if;
  select * into r from public.products where id = v_carton;
  if r.format_parent_id is not null or r.units_per_sale <> 1 or r.format_label is not null or r.stock <> 39 or r.price <> 25.00 then
    raise exception 'detached carton wrong: %', to_jsonb(r);
  end if;
  -- The shared lot is still on sale: the base label stays.
  if (select format_label from public.products where id = v_ndole) <> '1 paquet' then raise exception 'base label dropped too early'; end if;

  -- A product without formats needs a base label.
  begin
    perform public.attach_product_as_sale_format(t_a, v_piment, v_carton, 'Carton', 10, 'own', '  ');
    raise exception 'missing base label accepted';
  exception when others then if sqlerrm <> 'format_base_label_required' then raise; end if;
  end;

  -- Last format detached: the product is single-format again.
  perform public.attach_product_as_sale_format(t_a, v_piment, v_carton, 'Carton', 10, 'own', '1 sachet');
  if (select format_label from public.products where id = v_piment) <> '1 sachet' then raise exception 'new base label not set'; end if;
  perform public.detach_product_sale_format(t_a, v_carton);
  if (select format_label from public.products where id = v_piment) is not null then raise exception 'base label kept after last detach'; end if;

  reset role;
end $$;

-- Privileges: only the service role attaches or detaches.
do $$
begin
  if has_function_privilege('anon', 'public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text)', 'execute')
     or has_function_privilege('anon', 'public.detach_product_sale_format(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.detach_product_sale_format(uuid, uuid)', 'execute') then
    raise exception 'attach/detach callable by a client role';
  end if;
  if not has_function_privilege('service_role', 'public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.detach_product_sale_format(uuid, uuid)', 'execute') then
    raise exception 'service role cannot attach/detach';
  end if;
end $$;
