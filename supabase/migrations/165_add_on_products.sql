-- 165_add_on_products.sql
-- « Petits plus » : produits d'impulsion (chips, chocolats, sel, cubes,
-- épices…) choisis et ordonnés par la boutique, proposés dans le panier et la
-- confirmation d'ajout après les complémentaires du panier
-- (lib/cart/cartSuggestionRules.ts). Et le compteur de leurs ajouts par
-- emplacement, pour mesurer ce qui marche.
--
-- 1. products.add_on_position : NULL = pas un petit plus ; 1, 2, 3… = ordre.
--    Écrit uniquement par set_product_add_ons (liste complète, atomique). Une
--    colonne plutôt qu'une liste dans tenant_feature_settings : la config des
--    modules ne garde jamais de liste relationnelle (lib/tenantConfig/moduleConfig.ts).
-- 2. storefront_add_counts : compteurs AGRÉGÉS (jour × emplacement × produit),
--    aucune donnée personnelle, aucun identifiant de visiteur, pas de cookie.
--    Service role en lecture seule ; écrit par record_storefront_add.
--
-- Additive et rejouable. Le code lit la colonne en fail-open : migration
-- absente = liste vide, aucun compteur, le panier fonctionne comme avant.
--
-- Rollback :
--   drop function if exists public.record_storefront_add(uuid, uuid, text);
--   drop function if exists public.set_product_add_ons(uuid, uuid[]);
--   drop table if exists public.storefront_add_counts;
--   drop index if exists public.products_add_on_position_idx;
--   alter table public.products drop column if exists add_on_position;

-- ─── 1. Liste des petits plus ────────────────────────────────────────────────
alter table public.products
  add column if not exists add_on_position integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_add_on_position_range') then
    alter table public.products
      add constraint products_add_on_position_range check (add_on_position is null or add_on_position between 1 and 999);
  end if;
end $$;

create index if not exists products_add_on_position_idx
  on public.products (tenant_id, add_on_position)
  where add_on_position is not null;

comment on column public.products.add_on_position is
  'Petits plus (165) : NULL = non proposé ; 1, 2, 3… = ordre dans la liste de la boutique. Écrit par set_product_add_ons.';

-- Remplace toute la liste du tenant : positions effacées puis réécrites dans
-- l'ordre du tableau. Produits du tenant uniquement (les autres sont ignorés),
-- sans doublon, 40 au plus. Retourne le nombre de produits dans la liste.
create or replace function public.set_product_add_ons(p_tenant_id uuid, p_product_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  if p_tenant_id is null then raise exception 'add_ons_invalid_input'; end if;
  select coalesce(array_agg(id order by first_pos), '{}')
    into v_ids
    from (
      select u.id, min(u.pos) as first_pos
        from unnest(coalesce(p_product_ids, '{}'::uuid[])) with ordinality as u(id, pos)
       where u.id is not null
       group by u.id
    ) d;
  if coalesce(array_length(v_ids, 1), 0) > 40 then raise exception 'add_ons_too_many'; end if;

  update public.products set add_on_position = null
   where tenant_id = p_tenant_id and add_on_position is not null;

  update public.products p set add_on_position = o.pos
    from unnest(v_ids) with ordinality as o(id, pos)
   where p.id = o.id and p.tenant_id = p_tenant_id;

  select count(*) into v_count from public.products where tenant_id = p_tenant_id and add_on_position is not null;
  return v_count;
end $$;

-- ─── 2. Compteurs d'ajouts par emplacement ───────────────────────────────────
create table if not exists public.storefront_add_counts (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  day        date not null,
  placement  text not null check (placement in ('cart_suggestions', 'cart_fits', 'add_confirmation')),
  product_id uuid not null references public.products(id) on delete cascade,
  adds       integer not null default 0 check (adds >= 0),
  primary key (tenant_id, day, placement, product_id)
);

comment on table public.storefront_add_counts is
  'Ajouts au panier depuis une suggestion (165), agrégés par jour Europe/Paris, emplacement et produit. Aucune donnée personnelle.';

alter table public.storefront_add_counts enable row level security;
revoke all on public.storefront_add_counts from public, anon, authenticated, service_role;
grant select on public.storefront_add_counts to service_role;

-- +1 sur le compteur du jour. Ignore (false) un produit d'un autre tenant ou
-- inactif et un emplacement inconnu : jamais d'erreur côté boutique.
create or replace function public.record_storefront_add(p_tenant_id uuid, p_product_id uuid, p_placement text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null or p_product_id is null
     or p_placement not in ('cart_suggestions', 'cart_fits', 'add_confirmation') then
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

revoke all on function public.set_product_add_ons(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.record_storefront_add(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_product_add_ons(uuid, uuid[]) to service_role;
grant execute on function public.record_storefront_add(uuid, uuid, text) to service_role;
