-- Vérification post-application de la migration 140 (un brouillon n'est pas une dette).
-- À exécuter dans le SQL Editor Supabase APRÈS la migration. Transaction annulée :
-- aucune donnée conservée. Message final : « Migration 140 - vérifications OK ».

begin;

do $$
declare
  v_tenant   uuid;
  v_supplier uuid;
  v_purchase uuid;
  v_out      numeric;
  v_alloc    numeric;
  v_count    bigint;
  v_total    numeric;
begin
  if has_table_privilege('anon', 'public.supplier_purchase_financials', 'select')
     or has_table_privilege('authenticated', 'public.supplier_balances', 'select') then
    raise exception 'vues de solde lisibles par anon/authenticated';
  end if;

  insert into public.tenants (slug, name) values ('verif-140-' || substr(md5(random()::text), 1, 8), 'Vérif 140')
  returning id into v_tenant;
  select s.out_supplier_id into v_supplier
  from public.create_supplier(v_tenant, '{"name":"Fournisseur 140"}'::jsonb, 'verif-140-supplier', null) s;
  select p.out_purchase_id into v_purchase
  from public.save_supplier_purchase(v_tenant, null, jsonb_build_object('supplier_id', v_supplier),
    jsonb_build_array(jsonb_build_object('description', 'Article', 'ordered_quantity', 2, 'unit_cost', 10)),
    'verif-140-purchase', null) p;

  select f.outstanding, f.allocatable into v_out, v_alloc from public.supplier_purchase_financials f where f.purchase_id = v_purchase;
  if v_out <> 0 or v_alloc <> 20 then raise exception 'brouillon : reste % / affectable % (attendu 0 / 20)', v_out, v_alloc; end if;
  select b.purchase_count, b.total_purchased, b.outstanding into v_count, v_total, v_out
  from public.supplier_balances b where b.supplier_id = v_supplier;
  if v_count <> 0 or v_total <> 0 or v_out <> 0 then raise exception 'solde fournisseur avec brouillon : % / % / %', v_count, v_total, v_out; end if;

  perform 1 from public.set_supplier_purchase_status(v_tenant, v_purchase, 'ordered', null, null);
  select f.outstanding into v_out from public.supplier_purchase_financials f where f.purchase_id = v_purchase;
  if v_out <> 20 then raise exception 'commandé : reste % (attendu 20)', v_out; end if;
  select b.purchase_count, b.outstanding into v_count, v_out from public.supplier_balances b where b.supplier_id = v_supplier;
  if v_count <> 1 or v_out <> 20 then raise exception 'solde fournisseur commandé : % / %', v_count, v_out; end if;

  raise notice 'Migration 140 - vérifications OK';
end
$$;

rollback;
