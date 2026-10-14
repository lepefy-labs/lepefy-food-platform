-- Run after migrations through 157 on an isolated test database. All fixture
-- data is rolled back. Requires the 153 audit objects and 156 scheduler.
begin;

insert into public.tenants(id,slug,name) values
  ('15700000-0000-4000-8000-000000000001','campaign-test-a','Campaign test A'),
  ('15700000-0000-4000-8000-000000000002','campaign-test-b','Campaign test B');
insert into public.products(id,tenant_id,name,slug,price,stock,min_order_quantity) values
  ('15700000-0000-4000-8000-000000000011','15700000-0000-4000-8000-000000000001','Pommes','campaign-pommes',4.90,10,2),
  ('15700000-0000-4000-8000-000000000012','15700000-0000-4000-8000-000000000001','Poires','campaign-poires',8.00,1,2),
  ('15700000-0000-4000-8000-000000000021','15700000-0000-4000-8000-000000000002','Autre','campaign-autre',9.00,10,1);

do $$
begin
  if public.catalog_campaign_price(4.90,'percent',10,null)<>4.41
    or public.catalog_campaign_price(4.90,'fixed',1.25,null)<>3.65
    or public.catalog_campaign_price(4.90,'custom',null,3.10)<>3.10
    or public.catalog_campaign_price(4.95,'percent',50,null)<>2.48 then
    raise exception 'campaign discount calculation or monetary rounding failed';
  end if;
  if has_function_privilege('authenticated','public.catalog_campaign_action(uuid,uuid,text,integer,uuid,timestamptz)','execute')
    or has_table_privilege('authenticated','public.catalog_campaigns','select') then
    raise exception 'campaign data exposed to authenticated role';
  end if;
end $$;

do $$
declare a constant uuid:='15700000-0000-4000-8000-000000000001';
  key1 constant uuid:='15700000-0000-4000-8000-000000000300';
  c uuid;
begin
  c:=public.catalog_campaign_create(a,
    '{"name":"Création idempotente","kind":"promotion","discount_mode":"percent","discount_value":10}'::jsonb,
    null,key1);
  if c<>public.catalog_campaign_create(a,
    '{"name":"Création idempotente","kind":"promotion","discount_mode":"percent","discount_value":10}'::jsonb,
    null,key1) or (select count(*) from public.catalog_campaigns where name='Création idempotente')<>1 then
    raise exception 'retry created a second draft';
  end if;
end $$;

insert into public.catalog_campaigns(id,tenant_id,name,kind,discount_mode,discount_value,
  promo_starts_at,promo_ends_at,promo_until_sold_out) values
  ('15700000-0000-4000-8000-000000000101','15700000-0000-4000-8000-000000000001','Remise test',
   'promotion','percent',10,'2026-10-20 09:00+02','2026-10-31 23:59+01',true);

do $$
declare a constant uuid:='15700000-0000-4000-8000-000000000001';
  c constant uuid:='15700000-0000-4000-8000-000000000101';
  p constant uuid:='15700000-0000-4000-8000-000000000011';
  result jsonb; n integer;
begin
  n:=public.catalog_campaign_select_products(a,c,null,'campaign-',null,null,true);
  if n<>1 then raise exception 'bulk selection ignored minimum purchase quantity: %',n; end if;
  result:=public.catalog_campaign_search_products(a,c,'campaign-',null,null,true,1,25);
  if (result->>'total')::integer<>1 or result->'products'->0->>'id'<>p::text then
    raise exception 'search and bulk filters disagree: %',result;
  end if;
  result:=public.catalog_campaign_search_products(a,c,'campaign-',null,null,null,2,1);
  if (result->>'total')::integer<>2
    or result->'products'->0->>'id'<>p::text then
    raise exception 'search pagination lost a filtered product: %',result;
  end if;
  begin
    perform public.catalog_campaign_select_products('15700000-0000-4000-8000-000000000002',c,array[p],null,null,null,null);
    raise exception 'cross-tenant selection was accepted';
  exception when raise_exception then
    if sqlerrm not like 'campaign_not_editable%' then raise; end if;
  end;
end $$;

do $$
declare a constant uuid:='15700000-0000-4000-8000-000000000001';
  c constant uuid:='15700000-0000-4000-8000-000000000101';
  p constant uuid:='15700000-0000-4000-8000-000000000011';
  key1 constant uuid:='15700000-0000-4000-8000-000000000301';
  result jsonb; n integer;
begin
  result:=public.catalog_campaign_action(a,c,'publish',2,key1,'2026-10-20 09:00+02');
  if result->>'status'<>'running' or (select price from public.products where id=p)<>4.41
    or (select compare_at_price from public.products where id=p)<>4.90 then
    raise exception 'atomic publication did not apply the discount';
  end if;
  if public.catalog_campaign_action(a,c,'publish',2,key1,'2026-10-20 09:00+02')<>result then
    raise exception 'duplicate publication was not idempotent';
  end if;
  begin
    perform public.catalog_campaign_action(a,c,'publish',2,'15700000-0000-4000-8000-000000000302','2026-10-20 09:00+02');
    raise exception 'stale publication accepted';
  exception when raise_exception then
    if sqlerrm not like 'campaign_stale%' then raise; end if;
  end;
  n:=(select count(*) from public.catalog_campaign_tick('2026-10-20 09:01+02'));
  if n<>0 then raise exception 'scheduler reapplied an already running campaign'; end if;
  perform public.catalog_campaign_action(a,c,'suspend',3,'15700000-0000-4000-8000-000000000303','2026-10-21 09:00+02');
  if (select price from public.products where id=p)<>4.90 then raise exception 'suspension did not restore price'; end if;
  perform public.catalog_campaign_action(a,c,'resume',4,'15700000-0000-4000-8000-000000000304','2026-10-21 10:00+02');
  if (select price from public.products where id=p)<>4.41 then raise exception 'resume did not restore promotion'; end if;
  update public.products set stock=1 where id=p;
  if (select price from public.products where id=p)<>4.90
    or (select promo_campaign_id from public.products where id=p) is not null then
    raise exception 'minimum quantity stock guard failed';
  end if;
  perform public.catalog_campaign_action(a,c,'end',5,'15700000-0000-4000-8000-000000000305','2026-10-22 09:00+02');
  update public.products set stock=10 where id=p;
  if (select price from public.products where id=p)<>4.90 then raise exception 'restock restarted finished promotion'; end if;
end $$;

-- A manual promotion blocks publication, and the transaction leaves the
-- campaign in draft. A novelty campaign may overlap a promotion campaign.
insert into public.catalog_campaigns(id,tenant_id,name,kind,discount_mode,discount_value,
  promo_starts_at,promo_ends_at) values
  ('15700000-0000-4000-8000-000000000102','15700000-0000-4000-8000-000000000001','Manual conflict',
   'promotion','fixed',1,'2026-10-20 09:00+02','2026-10-30 09:00+01');
insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id) values
  ('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000102',
   '15700000-0000-4000-8000-000000000011');
update public.products set price=4.00,compare_at_price=4.90
  where id='15700000-0000-4000-8000-000000000011';
do $$
begin
  begin
    perform public.catalog_campaign_action('15700000-0000-4000-8000-000000000001',
      '15700000-0000-4000-8000-000000000102','publish',1,
      '15700000-0000-4000-8000-000000000306','2026-10-20 10:00+02');
    raise exception 'manual promotion overwritten';
  exception when raise_exception then
    if sqlerrm not like 'manual_promotion%' then raise; end if;
  end;
  if (select status from public.catalog_campaigns where id='15700000-0000-4000-8000-000000000102')<>'draft'
    then raise exception 'failed publication changed campaign status'; end if;
end $$;

insert into public.catalog_campaigns(id,tenant_id,name,kind,novelty_starts_at,novelty_ends_at) values
  ('15700000-0000-4000-8000-000000000103','15700000-0000-4000-8000-000000000001','Nouveautés',
   'novelty','2026-10-20 09:00+02','2026-10-27 09:00+01');
insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id) values
  ('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000103',
   '15700000-0000-4000-8000-000000000011');
do $$
begin
  perform public.catalog_campaign_action('15700000-0000-4000-8000-000000000001',
    '15700000-0000-4000-8000-000000000103','publish',1,
    '15700000-0000-4000-8000-000000000307','2026-10-20 09:00+02');
  if (select new_until from public.products where id='15700000-0000-4000-8000-000000000011')
    <> '2026-10-27 09:00+01'::timestamptz then raise exception 'novelty not applied'; end if;
  if (select price from public.products where id='15700000-0000-4000-8000-000000000011')<>4.00
    then raise exception 'novelty changed manual price'; end if;
  perform public.catalog_campaign_tick('2026-10-27 09:01+01');
  if (select new_until from public.products where id='15700000-0000-4000-8000-000000000011') is not null
    then raise exception 'novelty did not expire'; end if;
end $$;

-- Scheduled campaigns serialize their publication and reject overlapping
-- ownership before either price is changed. A delayed tick starts once.
update public.products set price=4.90,compare_at_price=null
  where id='15700000-0000-4000-8000-000000000011';
insert into public.catalog_campaigns(id,tenant_id,name,kind,discount_mode,discount_value,
  promo_starts_at,promo_ends_at) values
  ('15700000-0000-4000-8000-000000000104','15700000-0000-4000-8000-000000000001',
   'Programmée','promotion','fixed',1,'2026-11-01 09:00+01','2026-11-10 09:00+01'),
  ('15700000-0000-4000-8000-000000000105','15700000-0000-4000-8000-000000000001',
   'Chevauchement','promotion','percent',20,'2026-11-05 09:00+01','2026-11-15 09:00+01');
insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id) values
  ('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000104',
   '15700000-0000-4000-8000-000000000011'),
  ('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000105',
   '15700000-0000-4000-8000-000000000011');
do $$
declare a constant uuid:='15700000-0000-4000-8000-000000000001';
  c constant uuid:='15700000-0000-4000-8000-000000000104';
  p constant uuid:='15700000-0000-4000-8000-000000000011';
  copied uuid; n integer;
begin
  perform public.catalog_campaign_action(a,c,'publish',1,
    '15700000-0000-4000-8000-000000000308','2026-10-20 09:00+02');
  if (select status from public.catalog_campaigns where id=c)<>'scheduled'
    or (select price from public.products where id=p)<>4.90 then
    raise exception 'future campaign changed the price early';
  end if;
  begin
    perform public.catalog_campaign_action(a,'15700000-0000-4000-8000-000000000105','publish',1,
      '15700000-0000-4000-8000-000000000309','2026-10-20 09:00+02');
    raise exception 'overlapping campaign accepted';
  exception when raise_exception then
    if sqlerrm not like 'campaign_conflict%' then raise; end if;
  end;
  n:=(select count(*) from public.catalog_campaign_tick('2026-11-02 09:00+01')
    where out_change='campaign_changed');
  if n<>1 or (select price from public.products where id=p)<>3.90 then
    raise exception 'delayed scheduler did not start exactly one campaign';
  end if;
  n:=(select count(*) from public.catalog_campaign_tick('2026-11-02 09:01+01'));
  if n<>0 then raise exception 'scheduler replayed the start'; end if;
  copied:=public.catalog_campaign_duplicate(a,c,null,'15700000-0000-4000-8000-000000000310');
  if copied<>public.catalog_campaign_duplicate(a,c,null,'15700000-0000-4000-8000-000000000310')
    or (select status from public.catalog_campaigns where id=copied)<>'draft' then
    raise exception 'duplicate request created a second or active campaign';
  end if;
  begin
    update public.products set price=3.50 where id=p;
    raise exception 'direct price edit during campaign accepted';
  exception when raise_exception then
    if sqlerrm not like 'campaign_price_owned%' then raise; end if;
  end;
  perform set_config('lepefy.campaign_write','on',true);
  update public.products set price=3.50 where id=p;
  perform set_config('lepefy.campaign_write','off',true);
  perform public.catalog_campaign_action(a,c,'end',3,
    '15700000-0000-4000-8000-000000000311','2026-11-03 09:00+01');
  if (select price from public.products where id=p)<>3.50
    or (select promo_state from public.catalog_campaign_products where campaign_id=c and product_id=p)<>'conflict' then
    raise exception 'campaign end overwrote a newer price';
  end if;
end $$;

-- A conflict introduced after scheduling fails the whole campaign start and
-- is visible to the n8n caller; the product keeps its newer manual price.
insert into public.catalog_campaigns(id,tenant_id,name,kind,discount_mode,discount_value,
  promo_starts_at,promo_ends_at) values
  ('15700000-0000-4000-8000-000000000106','15700000-0000-4000-8000-000000000001',
   'Conflit tardif','promotion','percent',10,'2026-11-05 09:00+01','2026-11-15 09:00+01');
insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id) values
  ('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000106',
   '15700000-0000-4000-8000-000000000012');
do $$
declare a constant uuid:='15700000-0000-4000-8000-000000000001';
  c constant uuid:='15700000-0000-4000-8000-000000000106';
  p constant uuid:='15700000-0000-4000-8000-000000000012';
begin
  perform public.catalog_campaign_action(a,c,'publish',1,
    '15700000-0000-4000-8000-000000000312','2026-10-20 09:00+02');
  perform set_config('lepefy.campaign_write','on',true);
  update public.products set price=7.50,compare_at_price=8.00 where id=p;
  perform set_config('lepefy.campaign_write','off',true);
  if (select count(*) from public.catalog_campaign_tick('2026-11-06 09:00+01')
    where out_change='campaign_error')<>1 then raise exception 'scheduler hid a campaign failure'; end if;
  if (select status from public.catalog_campaigns where id=c)<>'scheduled'
    or (select last_error from public.catalog_campaigns where id=c) is null
    or (select price from public.products where id=p)<>7.50 then
    raise exception 'failed scheduled start partially changed state';
  end if;
end $$;

-- A mixed campaign may show novelty first and start its price window later.
update public.products set price=4.90,compare_at_price=null,promo_price=null
  where id='15700000-0000-4000-8000-000000000011';
insert into public.catalog_campaigns(id,tenant_id,name,kind,discount_mode,discount_value,
  promo_starts_at,promo_ends_at,novelty_starts_at,novelty_ends_at) values
  ('15700000-0000-4000-8000-000000000107','15700000-0000-4000-8000-000000000001',
   'Mixte','mixed','percent',10,'2026-11-10 09:00+01','2026-11-20 09:00+01',
   '2026-10-20 09:00+02','2026-11-08 09:00+01');
insert into public.catalog_campaign_products(tenant_id,campaign_id,product_id) values
  ('15700000-0000-4000-8000-000000000001','15700000-0000-4000-8000-000000000107',
   '15700000-0000-4000-8000-000000000011');
do $$
declare a constant uuid:='15700000-0000-4000-8000-000000000001';
  c constant uuid:='15700000-0000-4000-8000-000000000107';
  p constant uuid:='15700000-0000-4000-8000-000000000011';
begin
  perform public.catalog_campaign_action(a,c,'publish',1,
    '15700000-0000-4000-8000-000000000313','2026-10-20 09:00+02');
  if (select price from public.products where id=p)<>4.90
    or (select new_until from public.products where id=p) is null then
    raise exception 'mixed campaign applied promotion before its start';
  end if;
  perform public.catalog_campaign_tick('2026-11-08 09:01+01');
  if (select new_until from public.products where id=p) is not null then
    raise exception 'mixed novelty did not expire';
  end if;
  perform public.catalog_campaign_tick('2026-11-11 09:00+01');
  if (select price from public.products where id=p)<>4.41 then
    raise exception 'mixed promotion did not start after novelty';
  end if;
end $$;

rollback;
