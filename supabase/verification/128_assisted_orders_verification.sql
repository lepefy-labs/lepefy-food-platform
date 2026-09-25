-- Vérification post-application de la migration 128 (commandes assistées).
--
-- À exécuter dans le SQL Editor Supabase (rôle postgres) APRÈS `supabase db push`.
-- Tout se passe dans une transaction annulée : aucune donnée n'est conservée,
-- aucun stock réel n'est modifié. Chaque contrôle lève une exception explicite
-- en cas d'échec ; le message final « OK » confirme l'ensemble.
--
-- Contrôles :
--  1. schéma (colonnes, contraintes, index uniques, droits de la RPC) ;
--  2. conversion idempotente : 2 appels → 1 commande, 1 décrément de stock ;
--  3. contact téléphone seul accepté pour une session assistée, refusé storefront ;
--  4. stock insuffisant → commande `stock_conflict`, aucun décrément partiel ;
--  5. session annulée : confirmation manuelle refusée ;
--  6. une précommande assistée ne bloque pas le panier storefront du même client.
-- La sérialisation concurrente repose sur `SELECT … FOR UPDATE` de la session et
-- sur l'index unique `orders_checkout_session_id_uniq` (contrôlé en 1).

begin;

do $$
declare
  v_tenant    uuid;
  v_product   uuid;
  v_stock     integer;
  v_customer  uuid;
  v_session   uuid := gen_random_uuid();
  v_session2  uuid := gen_random_uuid();
  v_session3  uuid := gen_random_uuid();
  v_first     jsonb;
  v_second    jsonb;
  v_orders    integer;
  v_after     integer;
  v_failed    boolean;
begin
  -- 1. Schéma ---------------------------------------------------------------
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'checkout_sessions' and column_name = 'origin';
  if not found then raise exception 'checkout_sessions.origin manquant'; end if;
  perform 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'orders' and column_name = 'checkout_session_id';
  if not found then raise exception 'orders.checkout_session_id manquant'; end if;
  perform 1 from pg_indexes where schemaname = 'public' and indexname = 'orders_checkout_session_id_uniq';
  if not found then raise exception 'index unique orders_checkout_session_id_uniq manquant'; end if;
  perform 1 from pg_indexes where schemaname = 'public' and indexname = 'checkout_sessions_one_open_per_customer'
    and indexdef ilike '%origin%storefront%';
  if not found then raise exception 'index one_open_per_customer non limité au storefront'; end if;
  if has_function_privilege('anon', 'public.convert_checkout_session_to_order(uuid, uuid, jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.convert_checkout_session_to_order(uuid, uuid, jsonb)', 'execute') then
    raise exception 'la RPC de conversion ne doit pas être exécutable par anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.convert_checkout_session_to_order(uuid, uuid, jsonb)', 'execute') then
    raise exception 'service_role doit pouvoir exécuter la RPC de conversion';
  end if;

  -- Données de test (annulées en fin de script) ------------------------------
  select p.tenant_id, p.id, p.stock into v_tenant, v_product, v_stock
  from public.products p where p.active and p.stock >= 2 order by p.stock desc limit 1;
  if v_product is null then raise exception 'aucun produit actif avec stock >= 2 pour le test'; end if;

  insert into public.customers (id, tenant_id, full_name, phone, source)
  values (gen_random_uuid(), v_tenant, 'Test Assisté', '+390000000128', 'admin')
  returning id into v_customer;

  -- 3. Contact : téléphone seul accepté pour assisted, refusé pour storefront
  insert into public.checkout_sessions (id, tenant_id, customer_id, email, full_name, phone, fulfillment_type,
    shipping_total, items, origin, sales_channel, status, payment_method, expires_at)
  values (v_session, v_tenant, v_customer, null, 'Test Assisté', '+390000000128', 'pickup', 0,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'name', 'Test', 'price', 1.5, 'quantity', 2, 'storage_type', 'dry')),
    'assisted', 'whatsapp', 'open', 'stripe', now() + interval '72 hours');

  v_failed := false;
  begin
    insert into public.checkout_sessions (tenant_id, email, fulfillment_type, items, origin)
    values (v_tenant, null, 'pickup', '[]'::jsonb, 'storefront');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'une session storefront sans e-mail a été acceptée'; end if;

  -- 6. Le panier storefront ouvert du même client reste possible
  insert into public.checkout_sessions (tenant_id, customer_id, email, fulfillment_type, items, origin, status)
  values (v_tenant, v_customer, 'test-128@example.invalid', 'pickup', '[]'::jsonb, 'storefront', 'open');

  -- 2. Conversion idempotente -------------------------------------------------
  v_first := public.convert_checkout_session_to_order(v_tenant, v_session,
    jsonb_build_object('source', 'admin_recorded', 'payment_method', 'manual', 'external_payment_type', 'cash'));
  v_second := public.convert_checkout_session_to_order(v_tenant, v_session,
    jsonb_build_object('source', 'admin_recorded', 'payment_method', 'manual', 'external_payment_type', 'cash'));

  if (v_first->>'created')::boolean is not true then raise exception 'premier appel : created attendu'; end if;
  if (v_second->>'created')::boolean is not false then raise exception 'second appel : created=false attendu'; end if;
  if v_first->>'order_id' <> v_second->>'order_id' then raise exception 'deux commandes différentes pour une session'; end if;

  select count(*) into v_orders from public.orders where checkout_session_id = v_session;
  if v_orders <> 1 then raise exception 'attendu 1 commande, obtenu %', v_orders; end if;

  select stock into v_after from public.products where id = v_product;
  if v_after <> v_stock - 2 then raise exception 'stock décrémenté % fois (attendu une)', (v_stock - v_after) / 2.0; end if;

  perform 1 from public.orders
   where id = (v_first->>'order_id')::uuid and email is null and order_origin = 'assisted'
     and sales_channel = 'whatsapp' and payment_method = 'manual' and payment_status = 'paid'
     and payment_confirmation_source = 'admin_recorded' and status = 'preparing' and total = 3.00;
  if not found then raise exception 'commande convertie incorrecte (origine/paiement/statut/total)'; end if;
  perform 1 from public.order_items where order_id = (v_first->>'order_id')::uuid and quantity = 2;
  if not found then raise exception 'lignes de commande manquantes'; end if;
  perform 1 from public.checkout_sessions where id = v_session and status = 'completed' and order_id = (v_first->>'order_id')::uuid;
  if not found then raise exception 'session non clôturée'; end if;

  -- 4. Stock insuffisant → stock_conflict, aucun décrément ------------------
  insert into public.checkout_sessions (id, tenant_id, email, full_name, phone, fulfillment_type,
    shipping_total, items, origin, status, payment_method, expires_at)
  values (v_session2, v_tenant, null, 'Test', '+390000000128', 'pickup', 0,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'name', 'Test', 'price', 1, 'quantity', v_after + 1000)),
    'assisted', 'open', 'stripe', now() + interval '72 hours');
  v_first := public.convert_checkout_session_to_order(v_tenant, v_session2,
    jsonb_build_object('source', 'stripe_webhook', 'payment_method', 'stripe', 'stripe_payment_intent_id', 'pi_verification_128'));
  if (v_first->>'stock_conflict')::boolean is not true then raise exception 'stock_conflict attendu'; end if;
  perform 1 from public.orders where id = (v_first->>'order_id')::uuid and status = 'stock_conflict';
  if not found then raise exception 'commande stock_conflict attendue'; end if;
  if (select stock from public.products where id = v_product) <> v_after then raise exception 'décrément partiel détecté'; end if;

  -- 5. Session annulée : confirmation manuelle refusée ------------------------
  insert into public.checkout_sessions (id, tenant_id, email, full_name, phone, fulfillment_type,
    shipping_total, items, origin, status, payment_method, expires_at)
  values (v_session3, v_tenant, null, 'Test', '+390000000128', 'pickup', 0,
    jsonb_build_array(jsonb_build_object('productId', v_product, 'name', 'Test', 'price', 1, 'quantity', 1)),
    'assisted', 'cancelled', 'stripe', now());
  v_failed := false;
  begin
    perform public.convert_checkout_session_to_order(v_tenant, v_session3,
      jsonb_build_object('source', 'admin_verified', 'payment_method', 'external_link'));
  exception when others then v_failed := sqlerrm like 'session_not_convertible:cancelled%';
  end;
  if not v_failed then raise exception 'une session annulée a pu être confirmée manuellement'; end if;

  -- Isolation tenant : la RPC ne trouve pas la session sous un autre tenant
  v_failed := false;
  begin
    perform public.convert_checkout_session_to_order(gen_random_uuid(), v_session3,
      jsonb_build_object('source', 'admin_verified', 'payment_method', 'external_link'));
  exception when others then v_failed := sqlerrm like 'session_not_found%';
  end;
  if not v_failed then raise exception 'isolation tenant de la RPC non respectée'; end if;

  raise notice 'Migration 128 — vérifications OK';
end;
$$;

rollback;
