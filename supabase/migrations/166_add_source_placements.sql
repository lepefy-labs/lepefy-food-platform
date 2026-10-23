-- 166_add_source_placements.sql
-- Petits plus, phase 2 : trois nouveaux emplacements mesurés par les compteurs
-- d'ajouts de 165 (storefront_add_counts / record_storefront_add) :
--   catalog_shelf     — bloc « Les petits plus » du catalogue ;
--   product_page      — bloc « Pour compléter » de la fiche produit ;
--   checkout_delivery — ligne « Un petit plus ? » à l'étape livraison du checkout.
--
-- Additive et rejouable. Tant qu'elle n'est pas appliquée, ces emplacements
-- sont simplement ignorés par la RPC (aucune erreur côté boutique).
--
-- Rollback (perd les lignes des nouveaux emplacements) :
--   delete from public.storefront_add_counts where placement in ('catalog_shelf', 'product_page', 'checkout_delivery');
--   puis rejouer la contrainte et la fonction de 165.

do $$
declare
  v_name text;
begin
  for v_name in
    select conname from pg_constraint
     where conrelid = 'public.storefront_add_counts'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) like '%placement%'
  loop
    execute format('alter table public.storefront_add_counts drop constraint %I', v_name);
  end loop;
end $$;

alter table public.storefront_add_counts
  add constraint storefront_add_counts_placement_check check (placement in (
    'cart_suggestions', 'cart_fits', 'add_confirmation', 'catalog_shelf', 'product_page', 'checkout_delivery'
  ));

create or replace function public.record_storefront_add(p_tenant_id uuid, p_product_id uuid, p_placement text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or p_product_id is null
     or p_placement not in ('cart_suggestions', 'cart_fits', 'add_confirmation', 'catalog_shelf', 'product_page', 'checkout_delivery') then
    return false;
  end if;
  if not exists (select 1 from public.products where id = p_product_id and tenant_id = p_tenant_id and active) then
    return false;
  end if;
  insert into public.storefront_add_counts (tenant_id, day, placement, product_id, adds)
  values (p_tenant_id, (now() at time zone 'Europe/Paris')::date, p_placement, p_product_id, 1)
  on conflict (tenant_id, day, placement, product_id) do update set adds = storefront_add_counts.adds + 1;
  return true;
end $$;

revoke all on function public.record_storefront_add(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_storefront_add(uuid, uuid, text) to service_role;
