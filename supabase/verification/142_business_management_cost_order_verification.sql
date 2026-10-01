-- Vérification post-application de la migration 142 (ordre du coût d'achat courant).
--
-- À exécuter dans le SQL Editor Supabase APRÈS la migration 142. Transaction
-- annulée : un tenant temporaire, aucune donnée ni stock réel touché.
-- Message final : « Migration 142 - vérifications OK ».
--
-- Contrôles : défaut clock_timestamp() ; sécurité de refresh_product_cost ;
-- cache product_costs cohérente avec la règle pour TOUS les produits existants ;
-- scénario du bug (réception datée plus tard dans la journée puis réception
-- enregistrée après) ; un jour plus récent l'emporte sur l'ordre
-- d'enregistrement ; annulation restaure le coût précédent.

begin;

do $$
declare
  v_tenant    uuid;
  v_fish      uuid;
  v_supplier  uuid;
  v_purchase1 uuid;
  v_purchase2 uuid;
  v_purchase3 uuid;
  v_receipt1  uuid;
  v_receipt2  uuid;
  v_receipt3  uuid;
  v_day       date := (now() at time zone 'Europe/Paris')::date - 2;
  v_cost      numeric;
  v_source    uuid;
  v_count     bigint;
begin
  -- 1. Schéma et sécurité -------------------------------------------------------
  perform 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'product_cost_history' and c.column_name = 'created_at'
    and c.column_default like 'clock_timestamp()%';
  if not found then raise exception 'product_cost_history.created_at : défaut clock_timestamp() attendu'; end if;
  if has_function_privilege('anon', 'public.refresh_product_cost(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.refresh_product_cost(uuid, uuid)', 'execute') then
    raise exception 'refresh_product_cost exécutable par anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.refresh_product_cost(uuid, uuid)', 'execute') then
    raise exception 'refresh_product_cost non exécutable par service_role';
  end if;

  -- 2. Cache cohérente pour les données existantes (recalcul de la migration) -----
  select count(*) into v_count
  from (
    select distinct on (h.tenant_id, h.product_id) h.tenant_id, h.product_id, h.id
    from public.product_cost_history h
    where h.status = 'active' and h.product_id is not null
    order by h.tenant_id, h.product_id,
      (h.received_at at time zone 'Europe/Paris')::date desc, h.created_at desc, h.received_at desc, h.id desc
  ) expected
  left join public.product_costs c on c.tenant_id = expected.tenant_id and c.product_id = expected.product_id
  where c.source_history_id is distinct from expected.id;
  if v_count <> 0 then raise exception '% coût(s) courant(s) incohérent(s) avec la règle', v_count; end if;
  select count(*) into v_count
  from public.product_costs c
  where not exists (select 1 from public.product_cost_history h
                    where h.tenant_id = c.tenant_id and h.product_id = c.product_id and h.status = 'active');
  if v_count <> 0 then raise exception '% coût(s) sans entrée active', v_count; end if;

  -- Données de test -------------------------------------------------------------------
  insert into public.tenants (slug, name) values ('verif-142-' || substr(md5(random()::text), 1, 8), 'Vérif 142') returning id into v_tenant;
  insert into public.products (tenant_id, name, slug, price, stock) values (v_tenant, 'Poisson 500 g', 'verif-142-poisson', 9.9, 0) returning id into v_fish;
  select s.out_supplier_id into v_supplier
  from public.create_supplier(v_tenant, '{"name":"Fournisseur 142"}'::jsonb, 'verif-142-supplier', null) s;

  select p.out_purchase_id into v_purchase1
  from public.save_supplier_purchase(v_tenant, null, jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('product_id', v_fish, 'ordered_quantity', '5', 'purchase_unit', 'kg', 'stock_units_per_purchase_unit', '2', 'unit_cost', '8')),
    'verif-142-purchase-1', null) p;
  select p.out_purchase_id into v_purchase2
  from public.save_supplier_purchase(v_tenant, null, jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('product_id', v_fish, 'ordered_quantity', '2', 'purchase_unit', 'kg', 'stock_units_per_purchase_unit', '2', 'unit_cost', '10')),
    'verif-142-purchase-2', null) p;
  select p.out_purchase_id into v_purchase3
  from public.save_supplier_purchase(v_tenant, null, jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('product_id', v_fish, 'ordered_quantity', '1', 'purchase_unit', 'kg', 'stock_units_per_purchase_unit', '2', 'unit_cost', '12')),
    'verif-142-purchase-3', null) p;

  -- 3. Scénario du bug : 18:00 enregistrée d'abord, 09:00 du même jour ensuite --------
  select r.out_receipt_id into v_receipt1
  from public.record_supplier_receipt(v_tenant, v_purchase1,
    jsonb_build_array(jsonb_build_object('purchase_item_id', (select i.id from public.supplier_purchase_items i where i.purchase_id = v_purchase1), 'quantity', '5')),
    (v_day + time '18:00') at time zone 'Europe/Paris', null, 'verif-142-rec-1', null) r;
  select c.current_purchase_cost into v_cost from public.product_costs c where c.tenant_id = v_tenant and c.product_id = v_fish;
  if v_cost <> 4 then raise exception 'coût après la 1re réception % (attendu 8 / 2 = 4)', v_cost; end if;

  select r.out_receipt_id into v_receipt2
  from public.record_supplier_receipt(v_tenant, v_purchase2,
    jsonb_build_array(jsonb_build_object('purchase_item_id', (select i.id from public.supplier_purchase_items i where i.purchase_id = v_purchase2), 'quantity', '2')),
    (v_day + time '09:00') at time zone 'Europe/Paris', null, 'verif-142-rec-2', null) r;
  select c.current_purchase_cost, c.source_history_id into v_cost, v_source
  from public.product_costs c where c.tenant_id = v_tenant and c.product_id = v_fish;
  if v_cost <> 5 then raise exception 'même jour : la réception enregistrée en dernier doit l''emporter, coût % (attendu 10 / 2 = 5)', v_cost; end if;
  perform 1 from public.product_cost_history h where h.id = v_source and h.receipt_id = v_receipt2;
  if not found then raise exception 'source_history_id ne pointe pas vers la 2e réception'; end if;

  -- 4. Un jour antérieur enregistré ensuite ne remplace pas le coût -----------------
  select r.out_receipt_id into v_receipt3
  from public.record_supplier_receipt(v_tenant, v_purchase3,
    jsonb_build_array(jsonb_build_object('purchase_item_id', (select i.id from public.supplier_purchase_items i where i.purchase_id = v_purchase3), 'quantity', '1')),
    (v_day - 1 + time '23:30') at time zone 'Europe/Paris', null, 'verif-142-rec-3', null) r;
  select c.current_purchase_cost into v_cost from public.product_costs c where c.tenant_id = v_tenant and c.product_id = v_fish;
  if v_cost <> 5 then raise exception 'réception d''un jour antérieur devenue coût courant : % (attendu 5)', v_cost; end if;

  -- 5. Annulations : restauration exacte du coût précédent ---------------------------
  perform 1 from public.reverse_supplier_receipt(v_tenant, v_receipt2, 'Vérif 142', null);
  select c.current_purchase_cost into v_cost from public.product_costs c where c.tenant_id = v_tenant and c.product_id = v_fish;
  if v_cost <> 4 then raise exception 'après annulation de la 2e réception : % (attendu 4)', v_cost; end if;
  perform 1 from public.reverse_supplier_receipt(v_tenant, v_receipt1, 'Vérif 142', null);
  select c.current_purchase_cost into v_cost from public.product_costs c where c.tenant_id = v_tenant and c.product_id = v_fish;
  if v_cost <> 6 then raise exception 'après annulation de la 1re réception : % (attendu 12 / 2 = 6)', v_cost; end if;
  perform 1 from public.reverse_supplier_receipt(v_tenant, v_receipt3, 'Vérif 142', null);
  perform 1 from public.product_costs c where c.tenant_id = v_tenant and c.product_id = v_fish;
  if found then raise exception 'coût conservé sans aucune réception active'; end if;
  perform 1 from public.products pr where pr.id = v_fish and pr.stock = 0;
  if not found then raise exception 'stock non revenu à 0 après les annulations'; end if;

  raise notice 'Migration 142 - vérifications OK';
end
$$;

rollback;
