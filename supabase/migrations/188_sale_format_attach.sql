-- 188 — Rattacher un produit existant comme format de vente (et le détacher).
--
-- 187 crée les formats comme nouvelles lignes. Ici, un produit déjà en vente
-- (ex. « Bobolo — carton de 10 », avec son stock, ses promotions, ses paniers
-- et son historique) devient un format d'une autre fiche SANS changer d'id :
-- carts, sessions, Stripe et commandes restent sur `product_id`, son adresse
-- redirige vers la fiche mère tant qu'il est rattaché.
--
-- Le trigger 187 `products_sale_format_inherit` fait déjà l'héritage (nom
-- « Fiche — format », conservation, mode de réception, catégorie, jamais mis en
-- avant) et le stock dérivé en mode shared. Ces RPC ajoutent les contrôles,
-- l'ordre de verrouillage (fiche mère puis format, comme la propagation 187)
-- et l'écriture atomique. Aucun prix, aucune promotion, aucun stock « own »
-- n'est modifié ; `pack_count` n'est jamais un multiplicateur.
--
-- Rollback :
--   drop function if exists public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text);
--   drop function if exists public.detach_product_sale_format(uuid, uuid);

-- ─── 1. Rattacher ────────────────────────────────────────────────────────────
-- p_stock_mode : 'own' (défaut, le produit garde son stock, ex. cartons) ou
-- 'shared' (stock calculé depuis la fiche mère) — 'shared' seulement si le
-- produit n'a aucun stock propre, sinon ce stock disparaîtrait.
-- p_base_label : nom du format de base, requis si la fiche n'a pas encore de
-- formats (« 1 paquet »).
create or replace function public.attach_product_as_sale_format(
  p_tenant_id  uuid,
  p_parent_id  uuid,
  p_product_id uuid,
  p_label      text,
  p_units      integer,
  p_stock_mode text,
  p_base_label text
)
returns table (out_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent   public.products%rowtype;
  v_product  public.products%rowtype;
  v_label    text := nullif(btrim(p_label), '');
  v_base     text;
  v_mode     text := coalesce(nullif(btrim(p_stock_mode), ''), 'own');
  v_position integer;
begin
  if p_tenant_id is null or p_parent_id is null or p_product_id is null then
    raise exception 'formats_invalid_input';
  end if;
  if p_parent_id = p_product_id then
    raise exception 'format_attach_self';
  end if;

  -- Verrou fiche mère d'abord, puis le produit (même ordre que la propagation 187).
  select * into v_parent from public.products
   where id = p_parent_id and tenant_id = p_tenant_id
   for update;
  if not found or v_parent.format_parent_id is not null then
    raise exception 'format_parent_not_found';
  end if;

  select * into v_product from public.products
   where id = p_product_id and tenant_id = p_tenant_id
   for update;
  if not found then
    raise exception 'format_attach_not_found';
  end if;
  if v_product.format_parent_id is not null then
    raise exception 'format_attach_already_format';
  end if;
  if exists (select 1 from public.products c where c.format_parent_id = p_product_id) then
    raise exception 'format_has_formats';
  end if;

  if (select count(*) from public.products c where c.format_parent_id = p_parent_id and c.tenant_id = p_tenant_id) >= 8 then
    raise exception 'formats_too_many';
  end if;
  if v_label is null or char_length(v_label) > 60 then
    raise exception 'format_label_required';
  end if;
  if p_units is null or p_units < 2 or p_units > 999 then
    raise exception 'format_units_invalid';
  end if;
  if v_mode not in ('shared', 'own') then
    raise exception 'format_stock_mode_invalid';
  end if;
  if v_mode = 'shared' and coalesce(v_product.stock, 0) > 0 then
    raise exception 'format_attach_stock_not_empty';
  end if;

  v_base := coalesce(nullif(btrim(v_parent.format_label), ''), nullif(btrim(p_base_label), ''));
  if v_base is null then
    raise exception 'format_base_label_required';
  end if;
  if char_length(v_base) > 60 then
    raise exception 'format_label_required';
  end if;
  if lower(v_label) = lower(v_base) or exists (
    select 1 from public.products c
     where c.format_parent_id = p_parent_id and c.tenant_id = p_tenant_id
       and lower(btrim(c.format_label)) = lower(v_label)
  ) then
    raise exception 'format_label_duplicate';
  end if;

  select coalesce(max(c.format_position), 0) + 1 into v_position
    from public.products c
   where c.format_parent_id = p_parent_id and c.tenant_id = p_tenant_id;

  update public.products
     set format_label = v_base,
         format_position = 0,
         updated_at = now()
   where id = p_parent_id and tenant_id = p_tenant_id;

  -- Le trigger 187 recalcule nom, conservation, réception, catégorie, featured
  -- et, en mode shared, le stock. Un format se vend par 1 (son lot est
  -- units_per_sale) et n'est jamais un « petit plus ».
  update public.products
     set format_parent_id = p_parent_id,
         units_per_sale = p_units,
         format_label = v_label,
         format_position = v_position,
         format_stock_mode = v_mode,
         min_order_quantity = 1,
         order_quantity_step = 1,
         add_on_position = null,
         updated_at = now()
   where id = p_product_id and tenant_id = p_tenant_id;

  out_id := p_product_id;
  return next;
end
$$;

revoke all on function public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text) from public, anon, authenticated;
grant execute on function public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text) to service_role;

comment on function public.attach_product_as_sale_format(uuid, uuid, uuid, text, integer, text, text) is
  'Rattache un produit existant (même id, stock, promotions, paniers, commandes) comme format de vente d''une fiche. '
  'Stock own par défaut ; shared seulement sans stock propre. Erreurs format_* mappées dans lib/catalog/saleFormatsAdmin.ts.';

-- ─── 2. Détacher ─────────────────────────────────────────────────────────────
-- Seulement un format à stock propre (own) : un format partagé n'a pas de
-- stock à lui (miroir de la fiche) et se met hors vente depuis la liste. Le
-- produit redevient une fiche autonome avec son id, son stock, son prix et son
-- adresse ; son nom « Fiche — format » reste, à renommer depuis sa fiche.
create or replace function public.detach_product_sale_format(
  p_tenant_id  uuid,
  p_product_id uuid
)
returns table (out_id uuid, out_parent_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_id uuid;
  v_product   public.products%rowtype;
begin
  if p_tenant_id is null or p_product_id is null then
    raise exception 'formats_invalid_input';
  end if;

  select format_parent_id into v_parent_id from public.products
   where id = p_product_id and tenant_id = p_tenant_id;
  if v_parent_id is null then
    raise exception 'format_detach_not_format';
  end if;

  perform 1 from public.products where id = v_parent_id and tenant_id = p_tenant_id for update;
  select * into v_product from public.products
   where id = p_product_id and tenant_id = p_tenant_id
   for update;
  if v_product.format_parent_id is distinct from v_parent_id then
    raise exception 'format_not_found';
  end if;
  if v_product.format_stock_mode <> 'own' then
    raise exception 'format_detach_shared';
  end if;

  update public.products
     set format_parent_id = null,
         units_per_sale = 1,
         format_label = null,
         format_position = 0,
         updated_at = now()
   where id = p_product_id and tenant_id = p_tenant_id;

  -- Plus aucun format en vente : la fiche redevient à format unique.
  if not exists (select 1 from public.products c where c.format_parent_id = v_parent_id and c.active) then
    update public.products set format_label = null, updated_at = now()
     where id = v_parent_id and tenant_id = p_tenant_id;
  end if;

  out_id := p_product_id;
  out_parent_id := v_parent_id;
  return next;
end
$$;

revoke all on function public.detach_product_sale_format(uuid, uuid) from public, anon, authenticated;
grant execute on function public.detach_product_sale_format(uuid, uuid) to service_role;

comment on function public.detach_product_sale_format(uuid, uuid) is
  'Détache un format à stock propre : le produit redevient une fiche autonome (même id, stock, prix, adresse).';
