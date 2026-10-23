-- 165: add-on list (order, tenant isolation, replace) and aggregated add counters.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_mambo uuid := '30000000-0000-4000-8000-000000000001';
  v_cube uuid := '30000000-0000-4000-8000-000000000002';
  v_chips uuid := '30000000-0000-4000-8000-000000000003';
  v_other uuid := '30000000-0000-4000-8000-000000000009';
  v_count integer;
begin
  -- Order kept, duplicates removed, another tenant's product ignored.
  v_count := public.set_product_add_ons(v_a, array[v_cube, v_mambo, v_cube, v_other]);
  if v_count <> 2 then raise exception 'expected 2 add-ons, got %', v_count; end if;
  if (select add_on_position from public.products where id = v_cube) <> 1
     or (select add_on_position from public.products where id = v_mambo) <> 2 then
    raise exception 'positions not in array order';
  end if;
  if (select add_on_position from public.products where id = v_other) is not null then
    raise exception 'other tenant product was positioned';
  end if;

  -- Replacing the list clears the previous positions.
  v_count := public.set_product_add_ons(v_a, array[v_chips]);
  if v_count <> 1 or (select add_on_position from public.products where id = v_cube) is not null then
    raise exception 'list not replaced';
  end if;
  v_count := public.set_product_add_ons(v_a, '{}');
  if v_count <> 0 then raise exception 'empty list should clear everything'; end if;

  begin
    perform public.set_product_add_ons(v_a, (select array_agg(gen_random_uuid()) from generate_series(1, 41)));
    raise exception 'more than 40 accepted';
  exception when others then if sqlerrm <> 'add_ons_too_many' then raise; end if;
  end;

  -- Counters: +1 per add, inactive / other tenant / unknown placement ignored.
  if not public.record_storefront_add(v_a, v_mambo, 'cart_suggestions') then raise exception 'add not recorded'; end if;
  perform public.record_storefront_add(v_a, v_mambo, 'cart_suggestions');
  perform public.record_storefront_add(v_a, v_mambo, 'cart_fits');
  if public.record_storefront_add(v_a, v_chips, 'cart_suggestions') then raise exception 'inactive product counted'; end if;
  if public.record_storefront_add(v_a, v_other, 'cart_suggestions') then raise exception 'other tenant product counted'; end if;
  if public.record_storefront_add(v_a, v_mambo, 'homepage') then raise exception 'unknown placement counted'; end if;
  if (select adds from public.storefront_add_counts where product_id = v_mambo and placement = 'cart_suggestions') <> 2 then
    raise exception 'counter not incremented';
  end if;
  if (select count(*) from public.storefront_add_counts) <> 2 then raise exception 'unexpected counter rows'; end if;
end $$;

-- Privileges: only the service role runs the RPCs; it never writes the table directly.
set role authenticated;
do $$ begin
  perform public.record_storefront_add('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'cart_fits');
  raise exception 'authenticated can record adds';
exception when insufficient_privilege then null;
end $$;
reset role;
set role service_role;
do $$ begin
  perform 1 from public.storefront_add_counts;
  insert into public.storefront_add_counts (tenant_id, day, placement, product_id) values
    ('10000000-0000-4000-8000-000000000001', current_date, 'cart_fits', '30000000-0000-4000-8000-000000000002');
  raise exception 'service_role can insert counters directly';
exception when insufficient_privilege then null;
end $$;
reset role;
