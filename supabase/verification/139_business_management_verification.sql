-- Vérification post-application de la migration 139 (Gestion du commerce).
--
-- À exécuter dans le SQL Editor Supabase (rôle postgres) APRÈS l'application
-- de supabase/migrations/139_business_management.sql.
-- Tout se passe dans une transaction annulée (ROLLBACK) : deux tenants de test
-- temporaires sont créés puis supprimés, aucun tenant ni stock réel n'est touché.
-- Chaque contrôle lève une exception explicite ; le message final
-- « Migration 139 - vérifications OK » confirme l'ensemble.
--
-- Contrôles :
--  1. schéma : tables, colonnes, FK composites, index uniques, vues, bucket privé ;
--  2. sécurité : RLS sans policy, GRANT/REVOKE (anon, authenticated, service_role),
--     pas de DELETE sur les tables financières, EXECUTE des RPC ;
--  3. achats : fournisseur, achat, articles, totaux calculés côté serveur ;
--  4. réceptions : partielle, complète, rejeu idempotent, dépassement refusé,
--     stock incrémenté une seule fois, ledger, annulation ;
--  5. paiements : exemple 2 400 € (600 + 500 tiers + 300) = reste 1 000 €,
--     enregistré vs vérifié, affectation multiple, sur-affectation refusée,
--     cross-tenant refusé, annulation et reprise d'affectation ;
--  6. RPC PL/pgSQL : chaque RPC critique est réellement exécutée et ses colonnes
--     out_* sont lues.

begin;

do $$
declare
  v_tables text[] := array[
    'business_reference_counters', 'business_audit_events', 'suppliers', 'supplier_purchases',
    'supplier_purchase_items', 'supplier_receipts', 'supplier_receipt_items', 'inventory_movements',
    'supplier_payments', 'supplier_payment_allocations', 'business_documents'];
  v_no_delete text[] := array[
    'business_audit_events', 'suppliers', 'supplier_purchases', 'supplier_receipts', 'supplier_receipt_items',
    'inventory_movements', 'supplier_payments', 'supplier_payment_allocations', 'business_documents'];
  v_functions text[] := array[
    'public.next_business_reference(uuid, text)',
    'public.create_supplier(uuid, jsonb, text, uuid)',
    'public.update_supplier(uuid, uuid, jsonb, uuid)',
    'public.save_supplier_purchase(uuid, uuid, jsonb, jsonb, text, uuid)',
    'public.set_supplier_purchase_status(uuid, uuid, text, text, uuid)',
    'public.record_supplier_receipt(uuid, uuid, jsonb, timestamptz, text, text, uuid)',
    'public.reverse_supplier_receipt(uuid, uuid, text, uuid)',
    'public.adjust_inventory(uuid, uuid, integer, text, text, uuid)',
    'public.record_supplier_payment(uuid, jsonb, jsonb, text, uuid)',
    'public.allocate_supplier_payment(uuid, uuid, uuid, numeric, text, uuid)',
    'public.reverse_supplier_payment_allocation(uuid, uuid, text, uuid)',
    'public.verify_supplier_payment(uuid, uuid, uuid)',
    'public.void_supplier_payment(uuid, uuid, text, uuid)'];
  v_name        text;
  v_role        text;
  v_tenant_a    uuid;
  v_tenant_b    uuid;
  v_product_a   uuid;
  v_product_b   uuid;
  v_stock       integer;
  v_supplier    uuid;
  v_supplier_b  uuid;
  v_code        text;
  v_created     boolean;
  v_purchase    uuid;
  v_purchase2   uuid;
  v_purchase_b  uuid;
  v_reference   text;
  v_total       numeric;
  v_status      text;
  v_item_linked uuid;
  v_item_free   uuid;
  v_receipt     uuid;
  v_receipt2    uuid;
  v_count       bigint;
  v_pay1        uuid;
  v_pay2        uuid;
  v_pay3        uuid;
  v_pay4        uuid;
  v_pay5        uuid;
  v_pay_b       uuid;
  v_alloc       uuid;
  v_changed     boolean;
  v_outstanding numeric;
  v_unverified  numeric;
  v_allocatable numeric;
  v_failed      boolean;
begin
  -- 1. Schéma -------------------------------------------------------------------
  foreach v_name in array v_tables loop
    perform 1 from information_schema.tables where table_schema = 'public' and table_name = v_name;
    if not found then raise exception 'table % manquante', v_name; end if;
  end loop;
  perform 1 from information_schema.views where table_schema = 'public' and table_name = 'supplier_purchase_financials';
  if not found then raise exception 'vue supplier_purchase_financials manquante'; end if;
  perform 1 from information_schema.views where table_schema = 'public' and table_name = 'supplier_balances';
  if not found then raise exception 'vue supplier_balances manquante'; end if;
  perform 1 from pg_class c where c.relname in ('supplier_purchase_financials', 'supplier_balances')
    and not ('security_invoker=true' = any (coalesce(c.reloptions, array[]::text[])));
  if found then raise exception 'les vues de solde doivent être security_invoker'; end if;

  foreach v_name in array array['supplier_purchases_supplier_fk', 'supplier_purchase_items_purchase_fk',
    'supplier_purchase_items_product_fk', 'supplier_receipts_purchase_fk', 'supplier_receipt_items_purchase_item_fk',
    'inventory_movements_product_fk', 'supplier_payments_supplier_fk', 'supplier_payment_allocations_payment_fk',
    'supplier_payment_allocations_purchase_fk', 'products_tenant_id_id_key'] loop
    perform 1 from pg_constraint c where c.conname = v_name;
    if not found then raise exception 'contrainte % manquante', v_name; end if;
  end loop;
  perform 1 from pg_constraint c where c.conname = 'supplier_payment_allocations_purchase_fk'
    and array_length(c.conkey, 1) = 2;
  if not found then raise exception 'la FK allocation -> achat doit être composite (tenant_id, id)'; end if;

  foreach v_name in array array['supplier_payment_allocations_active_pair_idx', 'inventory_movements_source_idx',
    'suppliers_tenant_request_key_idx', 'supplier_purchases_tenant_request_key_idx'] loop
    perform 1 from pg_indexes where schemaname = 'public' and indexname = v_name;
    if not found then raise exception 'index % manquant', v_name; end if;
  end loop;

  perform 1 from storage.buckets b where b.id = 'business-documents' and b.public = false;
  if not found then raise exception 'bucket privé business-documents manquant ou public'; end if;

  -- 2. Sécurité -----------------------------------------------------------------
  foreach v_name in array v_tables loop
    perform 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_name and c.relrowsecurity;
    if not found then raise exception 'RLS non activée sur %', v_name; end if;
    perform 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_name;
    if found then raise exception 'aucune policy attendue sur %', v_name; end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, 'public.' || v_name, 'select')
         or has_table_privilege(v_role, 'public.' || v_name, 'insert')
         or has_table_privilege(v_role, 'public.' || v_name, 'update')
         or has_table_privilege(v_role, 'public.' || v_name, 'delete') then
        raise exception '% ne doit avoir aucun privilège sur %', v_role, v_name;
      end if;
    end loop;
    if not has_table_privilege('service_role', 'public.' || v_name, 'select')
       or not has_table_privilege('service_role', 'public.' || v_name, 'insert') then
      raise exception 'service_role doit pouvoir lire/écrire %', v_name;
    end if;
  end loop;
  foreach v_name in array v_no_delete loop
    if has_table_privilege('service_role', 'public.' || v_name, 'delete') then
      raise exception 'service_role ne doit pas pouvoir supprimer dans % (annulation, pas suppression)', v_name;
    end if;
  end loop;
  foreach v_name in array array['supplier_purchase_financials', 'supplier_balances'] loop
    if has_table_privilege('anon', 'public.' || v_name, 'select')
       or has_table_privilege('authenticated', 'public.' || v_name, 'select') then
      raise exception 'vue % lisible par anon/authenticated', v_name;
    end if;
    if not has_table_privilege('service_role', 'public.' || v_name, 'select') then
      raise exception 'vue % illisible par service_role', v_name;
    end if;
  end loop;
  foreach v_name in array v_functions loop
    if has_function_privilege('anon', v_name, 'execute') or has_function_privilege('authenticated', v_name, 'execute') then
      raise exception 'RPC % exécutable par anon/authenticated', v_name;
    end if;
    if not has_function_privilege('service_role', v_name, 'execute') then
      raise exception 'RPC % non exécutable par service_role', v_name;
    end if;
  end loop;

  perform 1 from public.admin_permissions p where p.key = 'supplier_payments.verify' and p.risk_level = 'critical';
  if not found then raise exception 'capability supplier_payments.verify (critical) manquante'; end if;
  select count(*) into v_count from public.admin_permissions p
  where p.key in ('suppliers.view', 'suppliers.manage', 'purchases.view', 'purchases.manage', 'inventory.view',
                  'inventory.manage', 'treasury.view', 'treasury.manage', 'supplier_payments.verify');
  if v_count <> 9 then raise exception 'capabilities Gestion incomplètes (%/9)', v_count; end if;
  perform 1 from public.admin_role_permissions rp
  join public.admin_roles r on r.id = rp.role_id
  where rp.permission_key = 'supplier_payments.verify' and r.code not in ('platform_owner', 'tenant_admin');
  if found then raise exception 'supplier_payments.verify attribuée à un rôle non système'; end if;

  -- Données de test (annulées) ---------------------------------------------------
  insert into public.tenants (slug, name) values ('verif-139-a-' || substr(md5(random()::text), 1, 8), 'Vérif 139 A')
  returning id into v_tenant_a;
  insert into public.tenants (slug, name) values ('verif-139-b-' || substr(md5(random()::text), 1, 8), 'Vérif 139 B')
  returning id into v_tenant_b;
  insert into public.products (tenant_id, name, slug, price, stock) values (v_tenant_a, 'Riz test', 'verif-riz', 10, 5)
  returning id into v_product_a;
  insert into public.products (tenant_id, name, slug, price, stock) values (v_tenant_b, 'Riz B', 'verif-riz-b', 10, 5)
  returning id into v_product_b;

  -- 3. Fournisseur et achat -------------------------------------------------------
  select s.out_supplier_id, s.out_code, s.out_created into v_supplier, v_code, v_created
  from public.create_supplier(v_tenant_a, '{"name":"Afro Distribution","email":"Contact@Afro.test"}'::jsonb, 'verif-supplier-001', null) s;
  if not v_created or v_code !~ '^FOU-[0-9]{6}$' then raise exception 'create_supplier: % %', v_created, v_code; end if;
  select s.out_created into v_created
  from public.create_supplier(v_tenant_a, '{"name":"Afro Distribution"}'::jsonb, 'verif-supplier-001', null) s;
  if v_created then raise exception 'create_supplier doit être idempotent'; end if;
  select count(*) into v_count from public.suppliers s where s.tenant_id = v_tenant_a;
  if v_count <> 1 then raise exception 'doublon fournisseur après rejeu'; end if;
  perform 1 from public.suppliers s where s.id = v_supplier and s.email = 'contact@afro.test';
  if not found then raise exception 'email fournisseur non normalisé'; end if;

  select u.out_updated into v_changed from public.update_supplier(v_tenant_a, v_supplier, '{"phone":"+39 333 000"}'::jsonb, null) u;
  if not v_changed then raise exception 'update_supplier'; end if;

  select s.out_supplier_id into v_supplier_b
  from public.create_supplier(v_tenant_b, '{"name":"Fournisseur B"}'::jsonb, 'verif-supplier-b01', null) s;

  select p.out_purchase_id, p.out_reference, p.out_created, p.out_total
  into v_purchase, v_reference, v_created, v_total
  from public.save_supplier_purchase(v_tenant_a, null,
    jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered', 'additional_costs', 100),
    jsonb_build_array(
      jsonb_build_object('product_id', v_product_a, 'ordered_quantity', 10, 'unit_cost', 150),
      jsonb_build_object('description', 'Sacs de manioc (hors catalogue)', 'ordered_quantity', 4, 'unit_cost', 200)),
    'verif-purchase-001', null) p;
  if not v_created or v_reference !~ '^ACH-[0-9]{4}-[0-9]{6}$' then raise exception 'save_supplier_purchase: % %', v_created, v_reference; end if;
  if v_total <> 2400 then raise exception 'total achat calculé % au lieu de 2400', v_total; end if;
  perform 1 from public.supplier_purchases sp where sp.id = v_purchase and sp.status = 'ordered' and sp.subtotal = 2300;
  if not found then raise exception 'achat non commandé ou sous-total faux'; end if;
  select p.out_created into v_created
  from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier), '[]'::jsonb, 'verif-purchase-001', null) p;
  if v_created then raise exception 'save_supplier_purchase doit être idempotent'; end if;

  -- Produit d'un autre tenant refusé.
  v_failed := false;
  begin
    perform 1 from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier),
      jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'ordered_quantity', 1, 'unit_cost', 1)),
      'verif-purchase-xtn', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'produit cross-tenant accepté dans un achat'; end if;
  -- Fournisseur d'un autre tenant refusé.
  v_failed := false;
  begin
    perform 1 from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier_b),
      '[]'::jsonb, 'verif-purchase-xsu', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'fournisseur cross-tenant accepté'; end if;
  -- FK composite : insertion directe cross-tenant refusée par le schéma.
  v_failed := false;
  begin
    insert into public.supplier_purchases (tenant_id, reference, supplier_id) values (v_tenant_a, 'X-FK', v_supplier_b);
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'FK composite fournisseur non appliquée'; end if;

  select i.id into v_item_linked from public.supplier_purchase_items i where i.purchase_id = v_purchase and i.product_id is not null;
  select i.id into v_item_free from public.supplier_purchase_items i where i.purchase_id = v_purchase and i.product_id is null;

  -- 4. Réceptions ----------------------------------------------------------------
  select r.out_receipt_id, r.out_reference, r.out_created, r.out_purchase_status
  into v_receipt, v_reference, v_created, v_status
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_item_linked, 'quantity', 6)),
    now(), 'Première livraison', 'verif-receipt-001', null) r;
  if not v_created or v_status <> 'partially_received' or v_reference !~ '^REC-[0-9]{4}-[0-9]{6}$' then
    raise exception 'réception partielle: % % %', v_created, v_status, v_reference;
  end if;
  select pr.stock into v_stock from public.products pr where pr.id = v_product_a;
  if v_stock <> 11 then raise exception 'stock après réception partielle: % (attendu 11)', v_stock; end if;

  -- Rejeu (double clic / retry) : aucun second incrément.
  select r.out_created into v_created
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_item_linked, 'quantity', 6)),
    now(), null, 'verif-receipt-001', null) r;
  if v_created then raise exception 'record_supplier_receipt doit être idempotent'; end if;
  select pr.stock into v_stock from public.products pr where pr.id = v_product_a;
  if v_stock <> 11 then raise exception 'le rejeu a modifié le stock (%)', v_stock; end if;
  select count(*) into v_count from public.inventory_movements m where m.tenant_id = v_tenant_a and m.movement_type = 'supplier_receipt';
  if v_count <> 1 then raise exception 'ledger: % mouvements au lieu de 1', v_count; end if;

  -- Dépassement de la quantité commandée refusé.
  v_failed := false;
  begin
    perform 1 from public.record_supplier_receipt(v_tenant_a, v_purchase,
      jsonb_build_array(jsonb_build_object('purchase_item_id', v_item_linked, 'quantity', 5)),
      now(), null, 'verif-receipt-over', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'réception au-delà de la quantité commandée acceptée'; end if;

  -- Réception complète.
  select r.out_receipt_id, r.out_purchase_status into v_receipt2, v_status
  from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_item_linked, 'quantity', 4),
                      jsonb_build_object('purchase_item_id', v_item_free, 'quantity', 4)),
    now(), null, 'verif-receipt-002', null) r;
  if v_status <> 'received' then raise exception 'réception complète: statut %', v_status; end if;
  select pr.stock into v_stock from public.products pr where pr.id = v_product_a;
  if v_stock <> 15 then raise exception 'stock après réception complète: % (attendu 15)', v_stock; end if;
  perform 1 from public.supplier_purchase_financials f where f.purchase_id = v_purchase and f.received_quantity = 14 and f.ordered_quantity = 14;
  if not found then raise exception 'quantités reçues incohérentes dans la vue'; end if;

  -- Annulation d'une réception : stock et statut recalculés, rejeu sans effet.
  select r.out_reversed, r.out_purchase_status into v_changed, v_status
  from public.reverse_supplier_receipt(v_tenant_a, v_receipt2, 'Erreur de saisie', null) r;
  if not v_changed or v_status <> 'partially_received' then raise exception 'annulation réception: % %', v_changed, v_status; end if;
  select pr.stock into v_stock from public.products pr where pr.id = v_product_a;
  if v_stock <> 11 then raise exception 'stock après annulation: % (attendu 11)', v_stock; end if;
  select r.out_reversed into v_changed from public.reverse_supplier_receipt(v_tenant_a, v_receipt2, 'Erreur de saisie', null) r;
  if v_changed then raise exception 'reverse_supplier_receipt doit être idempotent'; end if;
  perform 1 from public.inventory_movements m where m.movement_type = 'reversal' and m.quantity_delta = -4 and m.tenant_id = v_tenant_a;
  if not found then raise exception 'mouvement de reversal absent'; end if;
  -- On re-reçoit pour la suite.
  perform 1 from public.record_supplier_receipt(v_tenant_a, v_purchase,
    jsonb_build_array(jsonb_build_object('purchase_item_id', v_item_linked, 'quantity', 4),
                      jsonb_build_object('purchase_item_id', v_item_free, 'quantity', 4)),
    now(), null, 'verif-receipt-003', null);

  -- Ajustement manuel, idempotent, jamais sous zéro.
  select a.out_created, a.out_stock_after into v_created, v_stock
  from public.adjust_inventory(v_tenant_a, v_product_a, -2, 'Casse', 'verif-adjust-001', null) a;
  if not v_created or v_stock <> 13 then raise exception 'adjust_inventory: % %', v_created, v_stock; end if;
  select a.out_created into v_created from public.adjust_inventory(v_tenant_a, v_product_a, -2, 'Casse', 'verif-adjust-001', null) a;
  if v_created then raise exception 'adjust_inventory doit être idempotent'; end if;
  v_failed := false;
  begin
    perform 1 from public.adjust_inventory(v_tenant_a, v_product_a, -1000, 'Trop', 'verif-adjust-neg', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'stock négatif accepté'; end if;
  v_failed := false;
  begin
    perform 1 from public.adjust_inventory(v_tenant_a, v_product_b, 1, 'Cross', 'verif-adjust-xtn', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'ajustement cross-tenant accepté'; end if;

  -- 5. Paiements : exemple 2 400 € ----------------------------------------------
  select p.out_payment_id, p.out_reference, p.out_created into v_pay1, v_reference, v_created
  from public.record_supplier_payment(v_tenant_a,
    jsonb_build_object('supplier_id', v_supplier, 'amount', 600, 'method', 'bank_transfer', 'payment_date', current_date - 18),
    jsonb_build_array(jsonb_build_object('purchase_id', v_purchase, 'amount', 600)), 'verif-pay-0001', null) p;
  if not v_created or v_reference !~ '^PAY-[0-9]{4}-[0-9]{6}$' then raise exception 'record_supplier_payment: % %', v_created, v_reference; end if;

  -- Tiers sans nom de bénéficiaire refusé.
  v_failed := false;
  begin
    perform 1 from public.record_supplier_payment(v_tenant_a,
      jsonb_build_object('supplier_id', v_supplier, 'amount', 500, 'method', 'bank_transfer', 'beneficiary_type', 'third_party'),
      null, 'verif-pay-tiers-ko', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'paiement à un tiers sans bénéficiaire accepté'; end if;

  select p.out_payment_id into v_pay2
  from public.record_supplier_payment(v_tenant_a,
    jsonb_build_object('supplier_id', v_supplier, 'amount', 500, 'method', 'bank_transfer', 'beneficiary_type', 'third_party',
                       'beneficiary_name', 'Transitaire Dakar', 'supplier_instruction_note', 'Payer le transitaire'),
    jsonb_build_array(jsonb_build_object('purchase_id', v_purchase, 'amount', 500)), 'verif-pay-0002', null) p;
  select p.out_payment_id into v_pay3
  from public.record_supplier_payment(v_tenant_a,
    jsonb_build_object('supplier_id', v_supplier, 'amount', 300, 'method', 'cash'),
    jsonb_build_array(jsonb_build_object('purchase_id', v_purchase, 'amount', 300)), 'verif-pay-0003', null) p;

  -- Rejeu du paiement : pas de doublon.
  select p.out_created into v_created
  from public.record_supplier_payment(v_tenant_a,
    jsonb_build_object('supplier_id', v_supplier, 'amount', 300, 'method', 'cash'),
    jsonb_build_array(jsonb_build_object('purchase_id', v_purchase, 'amount', 300)), 'verif-pay-0003', null) p;
  if v_created then raise exception 'record_supplier_payment doit être idempotent'; end if;

  -- Enregistrés mais non vérifiés : la dette ne baisse pas encore.
  select f.outstanding, f.paid_unverified into v_outstanding, v_unverified
  from public.supplier_purchase_financials f where f.purchase_id = v_purchase;
  if v_outstanding <> 2400 or v_unverified <> 1400 then
    raise exception 'avant vérification: reste % / non vérifié % (attendu 2400 / 1400)', v_outstanding, v_unverified;
  end if;

  select v.out_status, v.out_changed into v_status, v_changed from public.verify_supplier_payment(v_tenant_a, v_pay1, null) v;
  if v_status <> 'verified' or not v_changed then raise exception 'verify_supplier_payment: % %', v_status, v_changed; end if;
  perform 1 from public.verify_supplier_payment(v_tenant_a, v_pay2, null);
  perform 1 from public.verify_supplier_payment(v_tenant_a, v_pay3, null);
  select v.out_changed into v_changed from public.verify_supplier_payment(v_tenant_a, v_pay3, null) v;
  if v_changed then raise exception 'verify_supplier_payment doit être idempotent'; end if;

  select f.outstanding, f.paid_unverified, f.allocatable into v_outstanding, v_unverified, v_allocatable
  from public.supplier_purchase_financials f where f.purchase_id = v_purchase;
  if v_outstanding <> 1000 or v_unverified <> 0 or v_allocatable <> 1000 then
    raise exception 'exemple 2400: reste % / non vérifié % / affectable % (attendu 1000 / 0 / 1000)', v_outstanding, v_unverified, v_allocatable;
  end if;
  perform 1 from public.supplier_payments p where p.id = v_pay2 and p.beneficiary_type = 'third_party'
    and p.supplier_id = v_supplier and p.beneficiary_name = 'Transitaire Dakar';
  if not found then raise exception 'paiement tiers: le créancier doit rester le fournisseur'; end if;

  -- Sur-affectation : un paiement de 1 500 € ne peut pas couvrir plus que le reste (1 000 €).
  select p.out_payment_id into v_pay4
  from public.record_supplier_payment(v_tenant_a,
    jsonb_build_object('supplier_id', v_supplier, 'amount', 1500, 'method', 'bank_transfer'), null, 'verif-pay-0004', null) p;
  v_failed := false;
  begin
    perform 1 from public.allocate_supplier_payment(v_tenant_a, v_pay4, v_purchase, 1100, 'verif-alloc-over', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'sur-affectation d''achat acceptée'; end if;

  -- Affectation multiple : 1 000 € sur l'achat 1, 500 € sur un second achat.
  select p.out_purchase_id into v_purchase2
  from public.save_supplier_purchase(v_tenant_a, null, jsonb_build_object('supplier_id', v_supplier, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('description', 'Huile', 'ordered_quantity', 10, 'unit_cost', 80)),
    'verif-purchase-002', null) p;
  select a.out_allocation_id, a.out_created into v_alloc, v_created
  from public.allocate_supplier_payment(v_tenant_a, v_pay4, v_purchase, 1000, 'verif-alloc-0001', null) a;
  if not v_created then raise exception 'allocate_supplier_payment'; end if;
  select a.out_created into v_created
  from public.allocate_supplier_payment(v_tenant_a, v_pay4, v_purchase, 1000, 'verif-alloc-0001', null) a;
  if v_created then raise exception 'allocate_supplier_payment doit être idempotent'; end if;
  perform 1 from public.allocate_supplier_payment(v_tenant_a, v_pay4, v_purchase2, 500, 'verif-alloc-0002', null);
  -- Le paiement est entièrement affecté : 1 € de plus est refusé.
  v_failed := false;
  begin
    perform 1 from public.allocate_supplier_payment(v_tenant_a, v_pay4, v_purchase2, 1, 'verif-alloc-0003', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'sur-affectation de paiement acceptée'; end if;

  -- Cross-tenant : paiement du tenant A affecté à un achat du tenant B.
  select p.out_purchase_id into v_purchase_b
  from public.save_supplier_purchase(v_tenant_b, null, jsonb_build_object('supplier_id', v_supplier_b, 'status', 'ordered'),
    jsonb_build_array(jsonb_build_object('product_id', v_product_b, 'ordered_quantity', 1, 'unit_cost', 10)),
    'verif-purchase-b01', null) p;
  v_failed := false;
  begin
    perform 1 from public.allocate_supplier_payment(v_tenant_a, v_pay4, v_purchase_b, 1, 'verif-alloc-xtn', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'affectation cross-tenant acceptée (RPC)'; end if;
  v_failed := false;
  begin
    insert into public.supplier_payment_allocations (tenant_id, payment_id, purchase_id, amount)
    values (v_tenant_a, v_pay4, v_purchase_b, 1);
  exception when foreign_key_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'affectation cross-tenant acceptée (FK)'; end if;
  v_failed := false;
  begin
    perform 1 from public.verify_supplier_payment(v_tenant_b, v_pay1, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'vérification d''un paiement d''un autre tenant acceptée'; end if;

  -- Reprise d'affectation, puis annulation de paiement.
  select r.out_changed into v_changed
  from public.reverse_supplier_payment_allocation(v_tenant_a, v_alloc, 'Mauvais achat', null) r;
  if not v_changed then raise exception 'reverse_supplier_payment_allocation'; end if;
  select r.out_changed into v_changed
  from public.reverse_supplier_payment_allocation(v_tenant_a, v_alloc, 'Mauvais achat', null) r;
  if v_changed then raise exception 'reverse_supplier_payment_allocation doit être idempotent'; end if;

  select v.out_status, v.out_changed into v_status, v_changed from public.void_supplier_payment(v_tenant_a, v_pay3, 'Doublon', null) v;
  if v_status <> 'voided' or not v_changed then raise exception 'void_supplier_payment: % %', v_status, v_changed; end if;
  select f.outstanding into v_outstanding from public.supplier_purchase_financials f where f.purchase_id = v_purchase;
  if v_outstanding <> 1300 then raise exception 'après annulation du paiement de 300: reste % (attendu 1300)', v_outstanding; end if;
  perform 1 from public.supplier_payments p where p.id = v_pay3;
  if not found then raise exception 'un paiement annulé doit rester en base'; end if;
  v_failed := false;
  begin
    perform 1 from public.verify_supplier_payment(v_tenant_a, v_pay3, null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'vérification d''un paiement annulé acceptée'; end if;

  -- Achat avec affectation : annulation refusée.
  v_failed := false;
  begin
    perform 1 from public.set_supplier_purchase_status(v_tenant_a, v_purchase2, 'cancelled', 'Test', null);
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'annulation d''un achat avec affectation acceptée'; end if;

  -- Solde fournisseur dérivé.
  select b.outstanding into v_outstanding from public.supplier_balances b where b.supplier_id = v_supplier;
  if v_outstanding <> 2100 then raise exception 'solde fournisseur % (attendu 2100 = 1300 + 800)', v_outstanding; end if;

  -- Audit.
  select count(*) into v_count from public.business_audit_events e
  where e.tenant_id = v_tenant_a and e.event_type in ('supplier.created', 'purchase.created', 'receipt.recorded',
    'receipt.reversed', 'inventory.adjusted', 'payment.recorded', 'payment.verified', 'payment.voided',
    'allocation.created', 'allocation.reversed');
  if v_count < 10 then raise exception 'journal d''audit incomplet (% événements)', v_count; end if;

  raise notice 'Migration 139 - vérifications OK';
end
$$;

rollback;
