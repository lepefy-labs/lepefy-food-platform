-- 166: new placements accepted and counted; unknown placements still ignored; privileges kept.
do $$
declare
  v_a uuid := '10000000-0000-4000-8000-000000000001';
  v_mambo uuid := '30000000-0000-4000-8000-000000000001';
  v_placement text;
begin
  foreach v_placement in array array['catalog_shelf', 'product_page', 'checkout_delivery', 'cart_suggestions'] loop
    if not public.record_storefront_add(v_a, v_mambo, v_placement) then raise exception 'placement % not recorded', v_placement; end if;
  end loop;
  if public.record_storefront_add(v_a, v_mambo, 'homepage') then raise exception 'unknown placement counted'; end if;
  if (select count(*) from public.storefront_add_counts where product_id = v_mambo and placement in ('catalog_shelf', 'product_page', 'checkout_delivery')) <> 3 then
    raise exception 'new placements not stored';
  end if;
  begin
    insert into public.storefront_add_counts (tenant_id, day, placement, product_id) values (v_a, current_date, 'homepage', v_mambo);
    raise exception 'check constraint accepts an unknown placement';
  exception when check_violation then null;
  end;
end $$;

set role authenticated;
do $$ begin
  perform public.record_storefront_add('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'product_page');
  raise exception 'authenticated can record adds';
exception when insufficient_privilege then null;
end $$;
reset role;
