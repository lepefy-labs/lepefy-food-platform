-- Runs on the 153 fixture after 153, 154, 155 and 156 (156 applied twice). Every check raises on failure.

-- ─── 1. Additive: existing rows unchanged ───────────────────────────────────
do $$
begin
  if exists (select 1 from public.products
             where promo_price is not null or promo_starts_at is not null or promo_ends_at is not null
                or promo_until_sold_out or promo_applied or new_until is not null) then
    raise exception '156 must leave existing products without promotion schedule or novelty';
  end if;
  if exists (select 1 from public.apply_product_promotion_schedule()) then
    raise exception 'the schedule must be a no-op on untouched products';
  end if;
end $$;

-- ─── 2. Constraints ─────────────────────────────────────────────────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
begin
  begin update public.products set promo_price = 0 where id = p; raise exception 'zero promo price accepted';
  exception when check_violation then null; end;
  begin
    update public.products set promo_starts_at = '2026-10-20 09:00+02', promo_ends_at = '2026-10-20 08:00+02' where id = p;
    raise exception 'end before start accepted';
  exception when check_violation then null; end;
end $$;

-- Second product of another tenant for isolation checks.
insert into public.tenants (id, slug, name)
select '22222222-2222-4222-8222-222222222222', 'autre', 'Autre boutique'
where not exists (select 1 from public.tenants where id = '22222222-2222-4222-8222-222222222222');
insert into public.products (id, tenant_id, name, slug, price, stock) values
  ('0c000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'Gari', 'gari', 3.20, 10);

-- ─── 3. Scheduled promotion: start, idempotence, end ────────────────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
  r record;
  n int;
begin
  -- Programmée du 20/10 09:00 au 31/10 23:59 (Paris), prix normal 4,90 → 3,90.
  update public.products set promo_price = 3.90,
    promo_starts_at = '2026-10-20 09:00+02', promo_ends_at = '2026-10-31 23:59+01'
  where id = p;

  -- Avant le début : rien ne change.
  select count(*) into n from public.apply_product_promotion_schedule('2026-10-19 12:00+02');
  if n <> 0 then raise exception 'promotion applied before its start'; end if;
  select * into r from public.products where id = p;
  if r.price <> 4.90 or r.compare_at_price is not null or r.promo_applied then raise exception 'price changed before start'; end if;

  -- Au début : prix promo, prix normal barré.
  select count(*) into n from public.apply_product_promotion_schedule('2026-10-20 09:00+02') where out_change = 'promo_started' and out_product_id = p;
  if n <> 1 then raise exception 'promotion not started'; end if;
  select * into r from public.products where id = p;
  if r.price <> 3.90 or r.compare_at_price <> 4.90 or not r.promo_applied then raise exception 'start did not apply promo price: % / %', r.price, r.compare_at_price; end if;

  -- Idempotent.
  select count(*) into n from public.apply_product_promotion_schedule('2026-10-25 12:00+02');
  if n <> 0 then raise exception 'second run changed rows'; end if;

  -- Le prix normal reste modifiable pendant la promo (compare_at_price).
  update public.products set compare_at_price = 5.20 where id = p;

  -- À la fin : prix normal restauré, programmation vidée.
  select count(*) into n from public.apply_product_promotion_schedule('2026-11-01 00:00+01') where out_change = 'promo_ended' and out_product_id = p;
  if n <> 1 then raise exception 'promotion not ended'; end if;
  select * into r from public.products where id = p;
  if r.price <> 5.20 or r.compare_at_price is not null or r.promo_applied or r.promo_price is not null
     or r.promo_starts_at is not null or r.promo_ends_at is not null then
    raise exception 'end did not restore the regular price: %', r.price;
  end if;
end $$;

-- ─── 4. Never a promo price above the regular price; expired before start ───
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
  r record;
begin
  update public.products set price = 4.90, promo_price = 6.00, promo_starts_at = null, promo_ends_at = null where id = p;
  perform public.apply_product_promotion_schedule('2026-11-02 10:00+01');
  select * into r from public.products where id = p;
  if r.promo_applied or r.price <> 4.90 then raise exception 'promo price above the regular price was applied'; end if;

  update public.products set promo_price = 3.00, promo_starts_at = '2026-11-03 10:00+01', promo_ends_at = '2026-11-04 10:00+01' where id = p;
  perform public.apply_product_promotion_schedule('2026-11-05 10:00+01');
  select * into r from public.products where id = p;
  if r.promo_price is not null or r.promo_applied or r.price <> 4.90 then raise exception 'missed promotion not dropped'; end if;
end $$;

-- ─── 5. Until sold out: ends with the stock, in the same transaction ────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
  r record;
begin
  update public.products set stock = 3, min_order_quantity = 1, promo_price = 3.90,
    promo_starts_at = null, promo_ends_at = null, promo_until_sold_out = true where id = p;
  perform public.apply_product_promotion_schedule('2026-11-06 10:00+01');
  select * into r from public.products where id = p;
  if not r.promo_applied or r.price <> 3.90 then raise exception 'until-sold-out promotion not started'; end if;

  update public.products set stock = 1 where id = p;
  select * into r from public.products where id = p;
  if not r.promo_applied then raise exception 'promotion ended while stock remained'; end if;

  update public.products set stock = 0 where id = p;
  select * into r from public.products where id = p;
  if r.promo_applied or r.price <> 4.90 or r.compare_at_price is not null or r.promo_until_sold_out then
    raise exception 'sold-out did not end the promotion: % applied=%', r.price, r.promo_applied;
  end if;

  -- Réassort : prix normal, pas de promo.
  update public.products set stock = 20 where id = p;
  perform public.apply_product_promotion_schedule('2026-11-06 11:00+01');
  select * into r from public.products where id = p;
  if r.promo_applied or r.price <> 4.90 then raise exception 'restock restarted the ended promotion'; end if;

  -- Une promo « jusqu'à épuisement » ne démarre pas sans stock.
  update public.products set stock = 0, promo_price = 3.90, promo_until_sold_out = true where id = p;
  perform public.apply_product_promotion_schedule('2026-11-06 12:00+01');
  select * into r from public.products where id = p;
  if r.promo_applied then raise exception 'until-sold-out promotion started without stock'; end if;
  update public.products set stock = 20, promo_price = null, promo_until_sold_out = false where id = p;
end $$;

-- ─── 6. Manual (undated) promotions are never touched ───────────────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
  r record;
begin
  update public.products set price = 3.50, compare_at_price = 4.90 where id = p;
  perform public.apply_product_promotion_schedule('2030-01-01 00:00+01');
  update public.products set stock = 0 where id = p;
  select * into r from public.products where id = p;
  if r.price <> 3.50 or r.compare_at_price <> 4.90 then raise exception 'manual promotion was modified'; end if;
  update public.products set price = 4.90, compare_at_price = null, stock = 20 where id = p;
end $$;

-- ─── 7. Novelties expire; tenants are processed independently ───────────────
do $$
declare
  a constant uuid := '0c000000-0000-4000-8000-000000000001';
  b constant uuid := '0c000000-0000-4000-8000-000000000002';
  n int;
begin
  update public.products set new_until = '2026-10-28 00:00+01' where id = a;
  update public.products set new_until = '2026-12-01 00:00+01' where id = b;
  select count(*) into n from public.apply_product_promotion_schedule('2026-11-10 00:00+01') where out_change = 'novelty_ended';
  if n <> 1 then raise exception 'expected exactly one novelty to end, got %', n; end if;
  if (select new_until from public.products where id = a) is not null then raise exception 'expired novelty kept'; end if;
  if (select new_until from public.products where id = b) is null then raise exception 'future novelty of another tenant cleared'; end if;
  if exists (select 1 from public.apply_product_promotion_schedule('2026-11-10 00:00+01') r
             where r.out_tenant_id <> (select tenant_id from public.products where id = r.out_product_id)) then
    raise exception 'tenant reported for a product of another tenant';
  end if;
end $$;

-- ─── 8. Grants: only the service role runs the schedule ─────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.apply_product_promotion_schedule(timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.apply_product_promotion_schedule(timestamptz)', 'execute') then
    raise exception 'schedule callable by a public role';
  end if;
  if not has_function_privilege('service_role', 'public.apply_product_promotion_schedule(timestamptz)', 'execute') then
    raise exception 'service role cannot run the schedule';
  end if;
end $$;

-- ─── 9. Activity journal records promotion and novelty changes ──────────────
do $$
declare
  p constant uuid := '0c000000-0000-4000-8000-000000000001';
begin
  perform set_config('request.jwt.claims', '{"role": "service_role"}', true);
  perform set_config('request.headers', '{"x-lepefy-audit-actor-type": "admin", "x-lepefy-audit-actor-id": "a0000000-0000-4000-8000-0000000000a1"}', true);
  update public.products set promo_price = 3.10, promo_ends_at = '2027-01-01 00:00+01' where id = p;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.price_updated'
                 and changes @> '[{"field": "promo_price", "after": 3.10}]') then
    raise exception 'promotion schedule change not recorded';
  end if;
  update public.products set new_until = '2027-01-01 00:00+01' where id = p;
  if not exists (select 1 from public.audit_events where event_type = 'catalog.product.updated'
                 and changes @> '[{"field": "new_until"}]') then
    raise exception 'novelty change not recorded';
  end if;
end $$;
