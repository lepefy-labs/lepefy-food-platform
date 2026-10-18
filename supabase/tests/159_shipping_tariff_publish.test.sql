-- Runs on the 159 fixture after 124, 125 and 159 (159 applied twice). Every check raises on failure.

-- ─── Seed: IT v1 active (2 bands, block, one per-parcel surcharge), FR v1 validated ──
insert into public.shipping_tariff_versions
  (id, tenant_id, country, version, status, name, bands, zone_surcharges, non_deliverable_zones,
   max_parcel_weight_g, block_weight_g, block_price_cents, logistics_verified_max_weight_g, prices_include_vat, activated_at)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'IT', 1, 'active', 'IT v1',
   '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":840},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
   '[{"zone_code":"IT_SICILY","amount_cents":200,"mode":"per_parcel"}]', '{IT_EXTRA_CUSTOMS}',
   15000, 30000, 1980, 50000, true, now()),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'FR', 1, 'validated', 'FR v1',
   '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":1400}]', '[]', '{}', 15000, null, null, null, true, null);
update public.tenants set shipping_pricing_mode = 'tariff' where id = '10000000-0000-4000-8000-000000000001';

-- ─── 1. Privileges: only service_role may execute ───────────────────────────
do $$ begin
  if has_function_privilege('anon', 'public.publish_shipping_tariff_version(uuid, uuid, jsonb, jsonb, int, text, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.publish_shipping_tariff_version(uuid, uuid, jsonb, jsonb, int, text, uuid)', 'execute') then
    raise exception 'publish must not be executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.publish_shipping_tariff_version(uuid, uuid, jsonb, jsonb, int, text, uuid)', 'execute') then
    raise exception 'service_role must execute publish';
  end if;
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_message text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm <> p_message then raise exception 'expected %, got %', p_message, sqlerrm; end if;
    return;
  end;
  raise exception 'expected error % but the call succeeded', p_message;
end $$;

-- ─── 2. Refusals (nothing written) ──────────────────────────────────────────
-- other tenant
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_version_not_found');
-- base not active
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":1500}]', '{}', null, null, null) $q$, 'tariff_base_not_active');
-- identical prices
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":840},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_no_change');
-- weights moved
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":6000,"price_cents":890},{"min_g_exclusive":6000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_structure_changed');
-- band dropped
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890}]', '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_structure_changed');
-- zone added
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200,"IT_SARDINIA":200}', 1980, null, null) $q$, 'tariff_structure_changed');
-- block removed
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', null, null, null) $q$, 'tariff_structure_changed');
-- invalid amounts
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":-1},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_price_invalid');
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890.5},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_price_invalid');
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":-5}', 1980, null, null) $q$, 'tariff_price_invalid');
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', -1, null, null) $q$, 'tariff_price_invalid');

do $$ begin
  if (select count(*) from public.shipping_tariff_versions) <> 2 then raise exception 'a refused publish wrote a row'; end if;
  if (select status from public.shipping_tariff_versions where id = '20000000-0000-4000-8000-000000000001') <> 'active' then
    raise exception 'a refused publish retired the base';
  end if;
end $$;

-- ─── 3. Publish: only prices change, base retired, new version active ───────
do $$
declare
  v public.shipping_tariff_versions;
begin
  -- an extra key on a band is dropped: bands are rebuilt from the base weights
  v := publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980,"x":1}]',
    '{"IT_SICILY":250}', 2100, 'Italie — prix du 18/10', 'a0000000-0000-4000-8000-0000000000a1');
  if v.version <> 2 or v.status <> 'active' or v.country <> 'IT' then raise exception 'unexpected new version %', row_to_json(v); end if;
  if v.bands <> '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":890},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]'::jsonb then
    raise exception 'bands not rebuilt from base: %', v.bands;
  end if;
  if v.zone_surcharges <> '[{"zone_code":"IT_SICILY","amount_cents":250,"mode":"per_parcel"}]'::jsonb then raise exception 'surcharges %', v.zone_surcharges; end if;
  if v.block_weight_g <> 30000 or v.block_price_cents <> 2100 or v.max_parcel_weight_g <> 15000
     or v.logistics_verified_max_weight_g <> 50000 or v.non_deliverable_zones <> '{IT_EXTRA_CUSTOMS}' or v.prices_include_vat is not true then
    raise exception 'structural parameters not copied: %', row_to_json(v);
  end if;
  if v.activated_by <> 'a0000000-0000-4000-8000-0000000000a1' or v.created_by <> 'a0000000-0000-4000-8000-0000000000a1' or v.activated_at is null then
    raise exception 'actor not recorded';
  end if;
  if (select status from public.shipping_tariff_versions where id = '20000000-0000-4000-8000-000000000001') <> 'retired'
     or (select retired_by from public.shipping_tariff_versions where id = '20000000-0000-4000-8000-000000000001') <> 'a0000000-0000-4000-8000-0000000000a1' then
    raise exception 'base not retired with actor';
  end if;
  if (select bands -> 0 ->> 'price_cents' from public.shipping_tariff_versions where id = '20000000-0000-4000-8000-000000000001') <> '840' then
    raise exception 'history modified';
  end if;
  if (select count(*) from public.shipping_tariff_versions where tenant_id = '10000000-0000-4000-8000-000000000001' and country = 'IT' and status = 'active') <> 1 then
    raise exception 'exactly one active IT version expected';
  end if;
  if (select shipping_pricing_mode from public.tenants where id = '10000000-0000-4000-8000-000000000001') <> 'tariff' then raise exception 'mode'; end if;
end $$;

-- ─── 4. Concurrency: a second admin publishing from the same (now retired) base is refused ──
select pg_temp.expect_error($q$ select publish_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
  '[{"min_g_exclusive":0,"max_g_inclusive":5000,"price_cents":950},{"min_g_exclusive":5000,"max_g_inclusive":30000,"price_cents":1980}]',
  '{"IT_SICILY":200}', 1980, null, null) $q$, 'tariff_base_not_active');
do $$ begin
  if (select count(*) from public.shipping_tariff_versions where country = 'IT') <> 2 then raise exception 'stale publish wrote a row'; end if;
end $$;

-- ─── 5. Rollback: the previous version can be reactivated with the existing RPC ──
do $$ begin
  perform activate_shipping_tariff_version('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', null);
  if (select version from public.shipping_tariff_versions where country = 'IT' and status = 'active') <> 1 then raise exception 'rollback failed'; end if;
end $$;
