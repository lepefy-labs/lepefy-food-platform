-- Vérification post-application de la migration 141 (Gestion Fase 1.1).
--
-- À exécuter dans le SQL Editor Supabase APRÈS la migration 141. Transaction
-- annulée : deux tenants temporaires, aucune donnée ni stock réel touché.
-- Message final : « Migration 141 - vérifications OK ».
--
-- Contrôles : schéma et sécurité (RLS, GRANT, REVOKE, RPC) ; quantités 12,5 kg,
-- 2,75 kg, 0,125 kg ; précision refusée ; conversion 12,5 x 2 = 25 unités ;
-- conversion non entière refusée ; réceptions partielles 5 + 7,5 = 12,5 sans
-- erreur flottante ; annulation exacte du stock et du coût ; dernier coût
-- d'achat et restauration du coût précédent ; historique append-only ;
-- rectification motivée sans coût inventé ; échéances (brouillon, annulé,
-- commandé en retard, soldé) ; cross-tenant.

begin;

do $$
declare
  v_role       text;
  v_name       text;
  v_tenant_a   uuid;
  v_tenant_b   uuid;
  v_fish       uuid;
  v_oil        uuid;
  v_product_b  uuid;
  v_supplier   uuid;
  v_supplier_b uuid;
  v_purchase   uuid;
  v_purchase2  uuid;
  v_purchase3  uuid;
  v_fish_line  uuid;
  v_free_line  uuid;
  v_tiny_line  uuid;
  v_oil_line   uuid;
  v_receipt1   uuid;
  v_receipt2   uuid;
  v_receipt3   uuid;
  v_stock      integer;
  v_cost       numeric;
  v_qty        numeric;
  v_due        date;
  v_status     text;
  v_created    boolean;
  v_count      bigint;
  v_failed     boolean;
  v_message    text;
  v_order_date date := current_date - 40;
begin
  -- 1. Schéma et sécurité ---------------------------------------------------------
  perform 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'supplier_purchase_items' and c.column_name = 'ordered_quantity'
    and c.data_type = 'numeric' and c.numeric_scale = 3;
  if not found then raise exception 'supplier_purchase_items.ordered_quantity doit être numeric(14,3)'; end if;
  perform 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'supplier_receipt_items' and c.column_name = 'quantity'
    and c.data_type = 'numeric' and c.numeric_scale = 3;
  if not found then raise exception 'supplier_receipt_items.quantity doit être numeric(14,3)'; end if;
  perform 1 from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'products' and c.column_name = 'stock' and c.data_type = 'integer';
  if not found then raise exception 'products.stock doit rester integer'; end if;
  foreach v_name in array array['purchase_unit', 'stock_units_per_purchase_unit'] loop
    perform 1 from information_schema.columns c where c.table_name = 'supplier_purchase_items' and c.column_name = v_name;
    if not found then raise exception 'supplier_purchase_items.% manquante', v_name; end if;
  end loop;
  foreach v_name in array array['source_quantity', 'source_unit', 'conversion_factor', 'source_reference', 'reason'] loop
    perform 1 from information_schema.columns c where c.table_name = 'inventory_movements' and c.column_name = v_name;
    if not found then raise exception 'inventory_movements.% manquante', v_name; end if;
  end loop;
  perform 1 from information_schema.columns c where c.table_name = 'supplier_purchases' and c.column_name = 'payment_due_date';
  if not found then raise exception 'supplier_purchases.payment_due_date manquante'; end if;
  perform 1 from information_schema.columns c where c.table_name = 'suppliers' and c.column_name = 'default_payment_terms_days';
  if not found then raise exception 'suppliers.default_payment_terms_days manquante'; end if;
  perform 1 from pg_proc p where p.proname = 'adjust_inventory' and pg_get_function_identity_arguments(p.oid) like '%p_note%';
  if not found then raise exception 'adjust_inventory(p_reason, p_note) manquante'; end if;
  perform 1 from pg_proc p where p.proname = 'adjust_inventory' and p.pronargs = 6;
  if found then raise exception 'l''ancienne signature adjust_inventory à 6 arguments doit être supprimée'; end if;

  foreach v_name in array array['product_costs', 'product_cost_history'] loop
    perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_name and c.relrowsecurity;
    if not found then raise exception 'RLS non activée sur %', v_name; end if;
    perform 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_name;
    if found then raise exception 'aucune policy attendue sur %', v_name; end if;
    if not has_table_privilege('service_role', 'public.' || v_name, 'select') then raise exception 'service_role doit lire %', v_name; end if;
  end loop;
  if has_table_privilege('service_role', 'public.product_cost_history', 'delete') then
    raise exception 'product_cost_history doit être append-only (pas de DELETE)';
  end if;
  foreach v_name in array array['product_costs', 'product_cost_history', 'supplier_purchase_financials', 'supplier_balances', 'inventory_product_overview'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, 'public.' || v_name, 'select') or has_table_privilege(v_role, 'public.' || v_name, 'insert') then
        raise exception '% ne doit avoir aucun accès à %', v_role, v_name;
      end if;
    end loop;
  end loop;
  perform 1 from pg_class c where c.relname in ('supplier_purchase_financials', 'supplier_balances', 'inventory_product_overview')
    and not ('security_invoker=true' = any (coalesce(c.reloptions, array[]::text[])));
  if found then raise exception 'vues Gestion : security_invoker attendu'; end if;
  foreach v_name in array array['public.set_supplier_purchase_due_date(uuid, uuid, date, uuid)', 'public.refresh_product_cost(uuid, uuid)',
    'public.adjust_inventory(uuid, uuid, integer, text, text, text, uuid)', 'public.record_supplier_receipt(uuid, uuid, jsonb, timestamptz, text, text, uuid)',
    'public.reverse_supplier_receipt(uuid, uuid, text, uuid)', 'public.business_quantity(text)'] loop
    if has_function_privilege('anon', v_name, 'execute') or has_function_privilege('authenticated', v_name, 'execute') then
      raise exception 'RPC % exécutable par anon/authenticated', v_name;
    end if;
    if not has_function_privilege('service_role', v_name, 'execute') then raise exception 'RPC % non exécutable par service_role', v_name; end if;
  end loop;

  -- Données de test -------------------------------------------------------------------
  insert into public.tenants (slug, name) values ('verif-141-a-' || substr(md5(random()::text), 1, 8), 'Vérif 141 A') returning id into v_tenant_a;
  insert into public.tenants (slug, name) values ('verif-141-b-' || substr(md5(random()::text), 1, 8), 'Vérif 141 B') returning id into v_tenant_b;
  insert into public.products (tenant_id, name, slug, price, stock) values (v_tenant_a, 'Poisson 500 g', 'verif-141-poisson', 6, 10) returning id into v_fish;
  insert into public.products (tenant_id, name, slug, price, stock) values (v_tenant_a, 'Huile 1 L', 'verif-141-huile', 5, 0) returning id into v_oil;
  insert into public.products (tenant_id, name, slug, price, stock) values (v_tenant_b, 'Produit B', 'verif-141-b', 5, 0) returning id into v_product_b;

  select s.out_supplier_id into v_supplier
  from public.create_supplier(v_tenant_a, '{"name":"Fournisseur 141","default_payment_terms_days":30}'::jsonb, 'verif-141-supplier', null) s;
  select s.out_supplier_id into v_supplier_b
  from public.create_supplier(v_tenant_b, '{"name":"Fournisseur B"}'::jsonb, 'verif-141-supplier-b', null) s;
  v_failed := false;
  begin
    perform 1 from public.create_supplier(v_tenant_a, '{"name":"X","default_payment_terms_days":4000}'::jsonb, 'verif-141-terms-ko', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'conditions de paiement > 3650 jours acceptées'; end if;

  -- 2. Quantités décimales, unités, conversion, échéance dérivée ---------------------
  select p.out_purchase_id into v_purchase
  from public.save_supplier_purchase(v_tenant_a, null,
    jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered', 'order_date', v_order_date),
    jsonb_build_array(
      jsonb_build_object('product_id', v_fish, 'ordered_quantity', '12.5', 'purchase_unit', 'kg', 'stock_units_per_purchase_unit', '2', 'unit_cost', '8'),
      jsonb_build_object('description', 'Gingembre vrac', 'ordered_quantity', '2.75', 'purchase_unit', 'kg', 'unit_cost', '4'),
      jsonb_build_object('description', 'Épices', 'ordered_quantity', '0.125', 'purchase_unit', 'kg', 'unit_cost', '40')),
    'verif-141-purchase', null) p;
  select sp.payment_due_date into v_due from public.supplier_purchases sp where sp.id = v_purchase;
  if v_due <> v_order_date + 30 then raise exception 'échéance dérivée % (attendue %)', v_due, v_order_date + 30; end if;
  perform 1 from public.supplier_purchases sp where sp.id = v_purchase and sp.subtotal = 100 + 11 + 5;
  if not found then raise exception 'sous-total décimal faux (attendu 116)'; end if;
  select i.id into v_fish_line from public.supplier_purchase_items i where i.purchase_id = v_purchase and i.product_id = v_fish;
  select i.id into v_free_line from public.supplier_purchase_items i where i.purchase_id = v_purchase and i.description = 'Gingembre vrac';
  select i.id into v_tiny_line from public.supplier_purchase_items i where i.purchase_id = v_purchase and i.description = 'Épices';
  perform 1 from public.supplier_purchase_items i where i.id = v_free_line and i.stock_units_per_purchase_unit is null and i.purchase_unit = 'kg';
  if not found then raise exception 'ligne hors catalogue : conversion nulle et unité kg attendues'; end if;

  -- Une modification ultérieure des conditions ne change pas l'échéance existante.
  perform 1 from public.update_supplier(v_tenant_a, v_supplier, '{"default_payment_terms_days":60}'::jsonb, null);
  select sp.payment_due_date into v_due from public.supplier_purchases sp where sp.id = v_purchase;
  if v_due <> v_order_date + 30 then raise exception 'échéance modifiée rétroactivement'; end if;

  v_failed := false;
  begin
    perform 1 from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier),
      jsonb_build_array(jsonb_build_object('description', 'X', 'ordered_quantity', '1.2345', 'unit_cost', '1')), 'verif-141-precision', null);
  exception when others then v_failed := true; v_message := sqlerrm;
  end;
  if not v_failed or v_message not like 'quantity_precision%' then raise exception 'précision > 3 décimales acceptée (%)', v_message; end if;

  -- 3. Réceptions partielles 5 + 7,5 = 12,5 kg -> +10 puis +15 unités -------------------
  select r.out_receipt_id into v_receipt1
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_fish_line, 'quantity', '5')), now() - interval '2 hours', null, 'verif-141-rec-1', null) r;
  select pr.stock into v_stock from public.products pr where pr.id = v_fish;
  if v_stock <> 20 then raise exception 'stock après 5 kg x 2 : % (attendu 20)', v_stock; end if;
  select c.current_purchase_cost into v_cost from public.product_costs c where c.product_id = v_fish;
  if v_cost <> 4 then raise exception 'coût par unité de stock % (attendu 8 / 2 = 4)', v_cost; end if;

  select r.out_receipt_id, r.out_purchase_status into v_receipt2, v_status
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_fish_line, 'quantity', '7.5')), now() - interval '1 hour', null, 'verif-141-rec-2', null) r;
  select pr.stock into v_stock from public.products pr where pr.id = v_fish;
  if v_stock <> 35 then raise exception 'stock après 7,5 kg x 2 : % (attendu 35)', v_stock; end if;
  if v_status <> 'partially_received' then raise exception 'statut % (attendu partially_received)', v_status; end if;
  select coalesce(sum(ri.quantity), 0) into v_qty from public.supplier_receipt_items ri where ri.purchase_item_id = v_fish_line;
  if v_qty <> 12.5 then raise exception 'reçu % kg (attendu 12,5 exactement)', v_qty; end if;
  perform 1 from public.inventory_movements m where m.source_type = 'supplier_receipt_item' and m.product_id = v_fish
    and m.quantity_delta = 15 and m.source_quantity = 7.5 and m.source_unit = 'kg' and m.conversion_factor = 2;
  if not found then raise exception 'mouvement « 7,5 kg -> +15 unités » non tracé'; end if;

  -- Rejeu : aucun second incrément.
  select r.out_created into v_created
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_fish_line, 'quantity', '7.5')), now(), null, 'verif-141-rec-2', null) r;
  select pr.stock into v_stock from public.products pr where pr.id = v_fish;
  if v_created or v_stock <> 35 then raise exception 'rejeu de réception non idempotent (%, stock %)', v_created, v_stock; end if;

  -- Dépassement de 0,001 kg refusé.
  v_failed := false;
  begin
    perform 1 from public.record_supplier_receipt(v_tenant_a, v_purchase,
      jsonb_build_array(jsonb_build_object('purchase_item_id', v_fish_line, 'quantity', '0.001')), now(), null, 'verif-141-over', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'réception au-delà de 12,5 kg acceptée'; end if;

  -- Lignes hors catalogue fractionnaires : aucun effet stock, achat reçu.
  select r.out_purchase_status into v_status
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_free_line, 'quantity', '2.75'),
                      jsonb_build_object('purchase_item_id', v_tiny_line, 'quantity', '0.125')), now(), null, 'verif-141-rec-free', null) r;
  if v_status <> 'received' then raise exception 'achat entièrement reçu : statut %', v_status; end if;
  select f.received_quantity into v_qty from public.supplier_purchase_financials f where f.purchase_id = v_purchase;
  if v_qty <> 15.375 then raise exception 'quantité reçue % (attendu 12,5 + 2,75 + 0,125 = 15,375)', v_qty; end if;

  -- 4. Conversion non entière refusée (3,5 x 1) ----------------------------------------
  select p.out_purchase_id into v_purchase2
  from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('product_id', v_oil, 'ordered_quantity', '3.5', 'purchase_unit', 'l', 'unit_cost', '3')),
    'verif-141-purchase-2', null) p;
  select i.id into v_oil_line from public.supplier_purchase_items i where i.purchase_id = v_purchase2;
  v_failed := false;
  begin
    perform 1 from public.record_supplier_receipt(v_tenant_a, v_purchase2,
      jsonb_build_array(jsonb_build_object('purchase_item_id', v_oil_line, 'quantity', '3.5')), now(), null, 'verif-141-rec-oil', null);
  exception when others then v_failed := true; v_message := sqlerrm;
  end;
  if not v_failed or v_message not like 'stock_units_not_integer%' then raise exception 'conversion non entière acceptée (%)', v_message; end if;
  select pr.stock into v_stock from public.products pr where pr.id = v_oil;
  if v_stock <> 0 then raise exception 'stock modifié par une réception refusée'; end if;

  -- 5. Dernier coût, annulation et restauration du coût précédent -----------------------
  select p.out_purchase_id into v_purchase3
  from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('product_id', v_fish, 'ordered_quantity', '3', 'purchase_unit', 'kg', 'stock_units_per_purchase_unit', '2', 'unit_cost', '10')),
    'verif-141-purchase-3', null) p;
  select r.out_receipt_id into v_receipt3
  from public.record_supplier_receipt(v_tenant_a, v_purchase3,
    jsonb_build_array(jsonb_build_object('purchase_item_id', (select i.id from public.supplier_purchase_items i where i.purchase_id = v_purchase3), 'quantity', '3')),
    now(), null, 'verif-141-rec-3', null) r;
  select c.current_purchase_cost into v_cost from public.product_costs c where c.product_id = v_fish;
  if v_cost <> 5 then raise exception 'dernier coût % (attendu 10 / 2 = 5)', v_cost; end if;
  select pr.stock into v_stock from public.products pr where pr.id = v_fish;
  if v_stock <> 41 then raise exception 'stock % (attendu 41)', v_stock; end if;

  perform 1 from public.reverse_supplier_receipt(v_tenant_a, v_receipt3, 'Test', null);
  select pr.stock into v_stock from public.products pr where pr.id = v_fish;
  if v_stock <> 35 then raise exception 'annulation : stock % (attendu 35, -6 exactement)', v_stock; end if;
  select c.current_purchase_cost into v_cost from public.product_costs c where c.product_id = v_fish;
  if v_cost <> 4 then raise exception 'coût après annulation % (attendu le précédent : 4)', v_cost; end if;
  perform 1 from public.product_cost_history h where h.receipt_id = v_receipt3 and h.status = 'reversed';
  if not found then raise exception 'historique de coût de la réception annulée non conservé'; end if;

  -- Annulation de la réception 7,5 kg : -15 exactement, valeurs historiques.
  update public.supplier_purchase_items i set stock_units_per_purchase_unit = 3 where i.id = v_fish_line; -- changement ultérieur
  perform 1 from public.reverse_supplier_receipt(v_tenant_a, v_receipt2, 'Test', null);
  select pr.stock into v_stock from public.products pr where pr.id = v_fish;
  if v_stock <> 20 then raise exception 'annulation 7,5 kg : stock % (attendu 20 avec la conversion historique 2)', v_stock; end if;
  perform 1 from public.reverse_supplier_receipt(v_tenant_a, v_receipt1, 'Test', null);
  perform 1 from public.product_costs c where c.product_id = v_fish;
  if found then raise exception 'plus aucune réception valide : le coût courant doit disparaître'; end if;

  -- Historique append-only.
  v_failed := false;
  begin
    update public.product_cost_history h set cost_per_stock_unit = 0 where h.receipt_id = v_receipt1;
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'historique de coût modifiable'; end if;

  -- 6. Rectification motivée, sans coût inventé -----------------------------------------
  select a.out_created, a.out_stock_after into v_created, v_stock
  from public.adjust_inventory(v_tenant_a, v_oil, 5, 'Inventaire physique', 'Comptage du soir', 'verif-141-adj-1', null) a;
  if not v_created or v_stock <> 5 then raise exception 'rectification +5 : % / %', v_created, v_stock; end if;
  perform 1 from public.inventory_movements m where m.request_key = 'verif-141-adj-1' and m.reason = 'Inventaire physique' and m.note = 'Comptage du soir';
  if not found then raise exception 'motif et note de rectification non conservés'; end if;
  perform 1 from public.product_costs c where c.product_id = v_oil;
  if found then raise exception 'une rectification ne doit pas créer de coût'; end if;
  v_failed := false;
  begin
    perform 1 from public.adjust_inventory(v_tenant_a, v_oil, -6, 'Casse', null, 'verif-141-adj-neg', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'stock négatif accepté'; end if;
  v_failed := false;
  begin
    perform 1 from public.adjust_inventory(v_tenant_a, v_oil, 1, ' ', null, 'verif-141-adj-noreason', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'rectification sans motif acceptée'; end if;

  -- 7. Échéances ----------------------------------------------------------------------
  -- Achat 2 : créé après le passage des conditions à 60 jours, échéance future (à venir).
  perform 1 from public.supplier_purchase_financials f where f.purchase_id = v_purchase2 and f.payment_due_date = current_date + 60 and f.outstanding = 10.5;
  if not found then raise exception 'achat 2 : échéance future (J+60) et reste 10,50 attendus'; end if;
  -- Achat 1 : commandé, échéance dépassée, reste à payer.
  perform 1 from public.supplier_purchase_financials f where f.purchase_id = v_purchase and f.payment_due_date < current_date and f.outstanding = 116;
  if not found then raise exception 'achat 1 : en retard avec reste à payer attendu'; end if;
  -- Soldé : reste 0 malgré l'échéance dépassée.
  perform 1 from public.verify_supplier_payment(v_tenant_a,
    (select p.out_payment_id from public.record_supplier_payment(v_tenant_a,
      jsonb_build_object('supplier_id', v_supplier, 'amount', 116, 'method', 'bank_transfer'),
      jsonb_build_array(jsonb_build_object('purchase_id', v_purchase, 'amount', 116)), 'verif-141-pay', null) p), null);
  perform 1 from public.supplier_purchase_financials f where f.purchase_id = v_purchase and f.outstanding = 0;
  if not found then raise exception 'achat soldé : reste 0 attendu'; end if;
  -- Brouillon : jamais de dette.
  select p.out_purchase_id into v_purchase3
  from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier, 'payment_due_date', current_date - 10),
    jsonb_build_array(jsonb_build_object('description', 'X', 'ordered_quantity', '1', 'unit_cost', '1')), 'verif-141-draft', null) p;
  perform 1 from public.supplier_purchase_financials f where f.purchase_id = v_purchase3 and f.outstanding = 0 and f.status = 'draft';
  if not found then raise exception 'brouillon avec échéance passée : reste 0 attendu'; end if;
  -- Échéance modifiable après réception, refusée sur un achat annulé.
  select d.out_payment_due_date into v_due from public.set_supplier_purchase_due_date(v_tenant_a, v_purchase, current_date + 5, null) d;
  if v_due <> current_date + 5 then raise exception 'set_supplier_purchase_due_date'; end if;
  perform 1 from public.set_supplier_purchase_status(v_tenant_a, v_purchase3, 'cancelled', 'Test', null);
  v_failed := false;
  begin
    perform 1 from public.set_supplier_purchase_due_date(v_tenant_a, v_purchase3, current_date, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'échéance modifiée sur un achat annulé'; end if;

  -- 8. Cross-tenant -------------------------------------------------------------------
  v_failed := false;
  begin
    perform 1 from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier),
      jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'ordered_quantity', '1', 'stock_units_per_purchase_unit', '2', 'unit_cost', '1')),
      'verif-141-xtn', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'conversion sur un produit d''un autre tenant acceptée'; end if;
  v_failed := false;
  begin
    insert into public.product_cost_history (tenant_id, product_id, purchase_id, receipt_id, receipt_item_id, received_at,
      purchase_quantity, purchase_unit, conversion_factor, stock_units, purchase_unit_cost, cost_per_stock_unit, currency)
    select v_tenant_b, v_product_b, v_purchase, v_receipt1, ri.id, now(), 1, 'unit', 1, 1, 1, 1, 'EUR'
    from public.supplier_receipt_items ri where ri.receipt_id = v_receipt1 limit 1;
  exception when foreign_key_violation or unique_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'historique de coût cross-tenant accepté'; end if;
  v_failed := false;
  begin
    perform 1 from public.adjust_inventory(v_tenant_a, v_product_b, 1, 'Cross', null, 'verif-141-adj-xtn', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'rectification cross-tenant acceptée'; end if;

  select count(*) into v_count from public.business_audit_events e where e.tenant_id = v_tenant_a and e.event_type = 'inventory.adjusted';
  if v_count <> 1 then raise exception 'audit de rectification attendu (%)', v_count; end if;

  raise notice 'Migration 141 - vérifications OK';
end
$$;

rollback;
