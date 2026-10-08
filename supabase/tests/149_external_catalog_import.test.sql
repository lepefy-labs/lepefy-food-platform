-- Runs after 149 and 150 have been applied (twice, idempotency) on the 149 fixture.
-- Executed AS service_role, like the app: a missing EXECUTE grant on a helper
-- function fails here (regression of the 149 grants, fixed by 150).
begin;
set local role service_role;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  owner constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  cat_a constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  cat_b constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000b';
  existing_a constant uuid := 'eeeeeeee-0000-4000-8000-00000000000a';
  product_b constant uuid := 'eeeeeeee-0000-4000-8000-00000000000b';
  h1 constant text := repeat('a', 64);
  h2 constant text := repeat('b', 64);
  h3 constant text := repeat('c', 64);
  src uuid;
  src_b uuid;
  item1 uuid;
  item2 uuid;
  created uuid;
  r record;
  t text;
  imgs jsonb;
begin
  -- 1. Privileges: browser roles have nothing, service role only what the app needs.
  foreach t in array array['external_catalog_sources', 'external_catalog_items', 'external_catalog_events'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update')
      then raise exception '% must not be accessible to browser roles', t; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') or not has_table_privilege('service_role', 'public.' || t, 'insert')
      then raise exception 'service_role must read and insert %', t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'delete') then raise exception '% must not be deletable', t; end if;
    if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = ('public.' || t)::regclass)
      then raise exception 'RLS must be enabled and forced on %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t)
      then raise exception '% must have no policy (service role only)', t; end if;
  end loop;
  if has_table_privilege('service_role', 'public.external_catalog_events', 'update')
    then raise exception 'events are append-only'; end if;
  if has_function_privilege('anon', 'public.external_catalog_apply_item(uuid, uuid, text, uuid, jsonb, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.external_catalog_record_fetch(uuid, uuid, jsonb, timestamptz, boolean, uuid)', 'execute')
     or has_function_privilege('anon', 'public.external_catalog_attach_images(uuid, uuid, uuid, jsonb, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.external_catalog_set_item_status(uuid, uuid, text, uuid)', 'execute')
    then raise exception 'RPCs must not be executable by browser roles'; end if;

  -- 2. Sources: checks on link, chat id, discount; one source per seller per tenant.
  insert into public.external_catalog_sources (tenant_id, label, source_url, seller_chat_id, created_by)
  values (a, 'Vendeur test', 'https://wa.me/c/191701838729307', '393296958822@c.us', owner) returning id into src;
  insert into public.external_catalog_sources (tenant_id, label, source_url, seller_chat_id)
  values (b, 'Vendeur test', 'https://wa.me/c/191701838729307', '393296958822@c.us') returning id into src_b;
  begin
    insert into public.external_catalog_sources (tenant_id, label, source_url, seller_chat_id) values (a, 'x', 'https://wa.me/c/191701838729307', '393296958822@c.us');
    raise exception 'duplicate seller for the same tenant accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.external_catalog_sources (tenant_id, label, source_url, seller_chat_id) values (a, 'x', 'http://evil.example/c/1', '393296958822@c.us');
    raise exception 'invalid source url accepted';
  exception when check_violation then null; end;
  begin
    update public.external_catalog_sources set default_discount_pct = 95 where id = src;
    raise exception 'discount above 90%% accepted';
  exception when check_violation then null; end;

  -- 3. First fetch: two new items.
  select * into r from public.external_catalog_record_fetch(a, src, jsonb_build_array(
    jsonb_build_object('provider_product_id', 'p1', 'raw', '{"id":"p1"}'::jsonb, 'normalized', '{"original_name":"Arachide"}'::jsonb,
                       'content_hash', h1, 'displayed_price', '10.00', 'currency', 'EUR'),
    jsonb_build_object('provider_product_id', 'p2', 'raw', '{"id":"p2"}'::jsonb, 'normalized', '{}'::jsonb,
                       'content_hash', h2, 'displayed_price', '16.00', 'currency', 'EUR')
  ), now(), false, owner);
  if r.out_new <> 2 then raise exception 'expected 2 new items, got %', r.out_new; end if;
  select id into item1 from public.external_catalog_items where source_id = src and provider_product_id = 'p1';
  select id into item2 from public.external_catalog_items where source_id = src and provider_product_id = 'p2';

  -- Cross-tenant: tenant B cannot record items on tenant A's source.
  begin
    perform public.external_catalog_record_fetch(b, src, '[]'::jsonb, now(), false, owner);
    raise exception 'cross-tenant fetch accepted';
  exception when others then
    if sqlerrm <> 'source_not_found' then raise; end if;
  end;

  -- 4. Apply is refused without consent.
  begin
    perform public.external_catalog_apply_item(a, item1, 'create', null,
      jsonb_build_object('name', 'Arachide ndolè', 'price', '3.33', 'min_order_quantity', '3', 'category_id', cat_a), 'req-create-0001', owner);
    raise exception 'apply without consent accepted';
  exception when others then
    if sqlerrm <> 'consent_required' then raise; end if;
  end;
  update public.external_catalog_sources set consent_status = 'granted', consent_recorded_at = now(), consent_recorded_by = owner where id = src;

  -- 5. Create: inactive product, stock 0, unique slug, audit, idempotent replay.
  select * into r from public.external_catalog_apply_item(a, item1, 'create', null,
    jsonb_build_object('name', 'Arachide ndolè', 'price', '3.33', 'min_order_quantity', '3', 'order_quantity_step', '1',
                       'weight_grams', '500', 'net_quantity_display', '500 g', 'category_id', cat_a), 'req-create-0001', owner);
  created := r.out_product_id;
  if not r.out_created or r.out_replayed then raise exception 'create flags wrong'; end if;
  if not exists (select 1 from public.products p where p.id = created and p.tenant_id = a and p.active = false and p.stock = 0
                   and p.price = 3.33 and p.min_order_quantity = 3 and p.slug = 'arachide-ndole-2' and p.weight_grams = 500)
    then raise exception 'created product is wrong: %', (select to_jsonb(p) from public.products p where p.id = created); end if;
  select * into r from public.external_catalog_apply_item(a, item1, 'create', null,
    jsonb_build_object('name', 'Arachide ndolè', 'price', '3.33'), 'req-create-0001', owner);
  if r.out_product_id <> created or not r.out_replayed then raise exception 'replay must return the same product'; end if;
  if (select count(*) from public.products where tenant_id = a) <> 2 then raise exception 'replay created a second product'; end if;
  if (select status from public.external_catalog_items where id = item1) <> 'linked' then raise exception 'item must be linked'; end if;
  begin
    perform public.external_catalog_apply_item(a, item1, 'create', null, jsonb_build_object('name', 'Doublon', 'price', '1'), 'req-create-0002', owner);
    raise exception 'second product created from a linked item';
  exception when others then if sqlerrm <> 'item_already_linked' then raise; end if; end;
  if (select fields->'price'->>'after' from public.external_catalog_events where request_key = 'req-create-0001') <> '3.33'
    then raise exception 'audit must record the applied price'; end if;

  -- 6. Validation.
  begin
    perform public.external_catalog_apply_item(a, item2, 'create', null, jsonb_build_object('name', 'X', 'price', '0'), 'req-bad-price-1', owner);
    raise exception 'zero price accepted';
  exception when others then if sqlerrm <> 'price_invalid' then raise; end if; end;
  begin
    perform public.external_catalog_apply_item(a, item2, 'create', null, jsonb_build_object('name', 'X', 'price', '1', 'stock', '5'), 'req-bad-field-1', owner);
    raise exception 'unknown field accepted';
  exception when others then if sqlerrm <> 'field_not_allowed:stock' then raise; end if; end;
  begin
    perform public.external_catalog_apply_item(a, item2, 'create', null, jsonb_build_object('name', 'X', 'price', '1', 'category_id', cat_b), 'req-bad-cat-01', owner);
    raise exception 'category of another tenant accepted';
  exception when others then if sqlerrm <> 'category_not_found' then raise; end if; end;
  begin
    perform public.external_catalog_apply_item(a, item2, 'update', product_b, jsonb_build_object('price', '1'), 'req-cross-prod1', owner);
    raise exception 'product of another tenant accepted';
  exception when others then if sqlerrm <> 'product_not_found' then raise; end if; end;
  begin
    perform public.external_catalog_apply_item(a, item2, 'create', null, jsonb_build_object('name', 'X', 'price', '1', 'min_order_quantity', '0'), 'req-bad-min-001', owner);
    raise exception 'minimum 0 accepted';
  exception when others then if sqlerrm <> 'out_of_range:min_order_quantity' then raise; end if; end;

  -- 7. Update an existing product: only provided fields change, before/after audited.
  select * into r from public.external_catalog_apply_item(a, item2, 'update', existing_a,
    jsonb_build_object('price', '4.00', 'min_order_quantity', '4'), 'req-update-0001', owner);
  if r.out_created then raise exception 'update must not create'; end if;
  if not exists (select 1 from public.products where id = existing_a and price = 4.00 and min_order_quantity = 4 and name = 'Arachide existante')
    then raise exception 'update wrote the wrong fields'; end if;
  if (select fields->'price'->>'before' from public.external_catalog_events where request_key = 'req-update-0001') <> '4.50'
    then raise exception 'audit must keep the previous price'; end if;
  begin
    perform public.external_catalog_apply_item(a, item1, 'update', existing_a, jsonb_build_object('price', '1'), 'req-double-link1', owner);
    raise exception 'one product linked to two items';
  exception when others then if sqlerrm <> 'product_already_linked' then raise; end if; end;

  -- 8. Images: only paths of the tenant/product, deduplicated, idempotent.
  select out_images into imgs from public.external_catalog_attach_images(a, item1, created, jsonb_build_array(
    jsonb_build_object('url', 'https://x.supabase.co/storage/v1/object/public/assets/tenants/' || a || '/products/' || created || '/wa-1.jpg', 'alt', 'Arachide'),
    jsonb_build_object('url', 'https://x.supabase.co/storage/v1/object/public/assets/tenants/' || a || '/products/' || created || '/wa-1.jpg', 'alt', 'Arachide')
  ), 'req-images-0001', owner);
  if jsonb_array_length(imgs) <> 1 then raise exception 'images must be deduplicated, got %', imgs; end if;
  if (select image_url from public.products where id = created) is null then raise exception 'image_url must be set'; end if;
  begin
    perform public.external_catalog_attach_images(a, item1, created, jsonb_build_array(
      jsonb_build_object('url', 'https://evil.example/tenants/' || b || '/x.jpg')), 'req-images-bad1', owner);
    raise exception 'foreign image path accepted';
  exception when others then if sqlerrm <> 'image_url_invalid' then raise; end if; end;

  -- 9. Next fetch: p1 changed content → changed; p2 unchanged price change tracked; p3 new; truncated keeps missing ones.
  select * into r from public.external_catalog_record_fetch(a, src, jsonb_build_array(
    jsonb_build_object('provider_product_id', 'p1', 'content_hash', h3, 'displayed_price', '12.00', 'currency', 'EUR'),
    jsonb_build_object('provider_product_id', 'p3', 'content_hash', h1, 'displayed_price', '5.00', 'currency', 'EUR')
  ), now(), true, owner);
  if (select status from public.external_catalog_items where id = item1) <> 'changed' then raise exception 'p1 must be changed'; end if;
  if (select previous_price from public.external_catalog_items where id = item1) <> 10.00 then raise exception 'previous price must be kept'; end if;
  if (select status from public.external_catalog_items where id = item2) <> 'linked' then raise exception 'truncated fetch must not mark p2 unavailable'; end if;

  -- Complete fetch without p2 → unavailable.
  perform public.external_catalog_record_fetch(a, src, jsonb_build_array(
    jsonb_build_object('provider_product_id', 'p1', 'content_hash', h3, 'displayed_price', '12.00', 'currency', 'EUR')
  ), now(), false, owner);
  if (select status from public.external_catalog_items where id = item2) <> 'unavailable' then raise exception 'p2 must be unavailable'; end if;

  -- 10. Dismiss blocks apply; restore recomputes status.
  perform public.external_catalog_set_item_status(a, item1, 'dismiss', owner);
  begin
    perform public.external_catalog_apply_item(a, item1, 'update', created, jsonb_build_object('price', '3.50'), 'req-dismissed-1', owner);
    raise exception 'apply on dismissed item accepted';
  exception when others then if sqlerrm <> 'item_dismissed' then raise; end if; end;
  if (select out_status from public.external_catalog_set_item_status(a, item1, 'restore', owner)) <> 'changed'
    then raise exception 'restore must recompute changed'; end if;

  -- 11. Product deletion keeps the item (link set to null, tenant_id intact).
  delete from public.products where id = existing_a;
  if (select linked_product_id from public.external_catalog_items where id = item2) is not null then raise exception 'link must be cleared'; end if;
  if (select tenant_id from public.external_catalog_items where id = item2) <> a then raise exception 'tenant_id must survive'; end if;

  raise notice '149 external catalog import: all checks passed';
end;
$$;
rollback;
