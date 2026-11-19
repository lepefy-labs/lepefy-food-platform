-- 187_product_sale_formats.sql
-- Formats de vente sous une seule fiche (« 1 paquet » / « Lot de 3 paquets »).
-- Contrat : docs/PRODUCT_SALE_FORMATS.md.
--
-- Modèle : chaque format est une référence vendable (ligne `products`) avec son
-- propre id, prix, promotion, poids et statut. La fiche canonique est le
-- produit existant, qui devient le format de base (unité = 1) et garde id,
-- slug, URL, paniers et commandes. Un format supplémentaire est une ligne
-- enfant (`format_parent_id`). Le panier, la synchronisation, les sessions,
-- Stripe et les commandes restent sur `product_id`.
--
-- Stock : en mode `shared` (défaut), le stock qui fait foi est celui du parent,
-- en unités de base. L'enfant expose `stock = floor(stock parent / unités)`,
-- recalculé par trigger ; une écriture directe d'une autre valeur est refusée
-- (`format_stock_is_derived`) — éditeur, Gestion, import externe compris.
-- En mode `own` (cartons réellement séparés), l'enfant garde son propre stock.
-- `decrement_stock_for_order` additionne les unités de base par stock avant le
-- décrément atomique : 2 lots + 1 paquet consomment 7 paquets.
--
-- Additif : colonnes avec défaut neutre, aucun backfill. Un produit sans
-- enfant se comporte exactement comme avant (unité 1, même décrément).
-- `pack_count` (154) reste purement descriptif et n'est jamais un multiplicateur.
--
-- Rollback (code revert d'abord, puis seulement si nécessaire) :
--   update public.products set active = false where format_parent_id is not null;
--   réappliquer 029 (decrement_stock_for_order), 162 §2 (snapshot), 109
--   (catalog_ranked_product_ids), 156 §5 (match_products) et 156 §6 (audit) ;
--   drop trigger products_sale_format_inherit / products_sale_format_propagate on public.products;
--   drop function public.products_sale_format_inherit(), public.products_sale_format_propagate(),
--     public.set_product_sale_formats(uuid, uuid, text, jsonb);
--   Les colonnes peuvent rester (inertes) : les snapshots de commande en dépendent pas.

-- ─── 1. Colonnes ─────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists format_parent_id  uuid,
  add column if not exists units_per_sale    integer not null default 1,
  add column if not exists format_label      text,
  add column if not exists format_position   integer not null default 0,
  add column if not exists format_stock_mode text not null default 'shared';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_tenant_id_id_key') then
    alter table public.products add constraint products_tenant_id_id_key unique (tenant_id, id);
  end if;
end $$;

alter table public.products drop constraint if exists products_format_parent_fk;
alter table public.products add constraint products_format_parent_fk
  foreign key (tenant_id, format_parent_id) references public.products (tenant_id, id) on delete restrict;

alter table public.products drop constraint if exists products_format_not_self;
alter table public.products add constraint products_format_not_self
  check (format_parent_id is null or format_parent_id <> id);

alter table public.products drop constraint if exists products_units_per_sale_range;
alter table public.products add constraint products_units_per_sale_range
  check (units_per_sale between 1 and 999 and (format_parent_id is not null or units_per_sale = 1));

alter table public.products drop constraint if exists products_format_label_length;
alter table public.products add constraint products_format_label_length
  check (format_label is null or char_length(btrim(format_label)) between 1 and 60);

alter table public.products drop constraint if exists products_format_stock_mode;
alter table public.products add constraint products_format_stock_mode
  check (format_stock_mode in ('shared', 'own'));

create index if not exists products_format_parent_idx on public.products (format_parent_id)
  where format_parent_id is not null;

comment on column public.products.format_parent_id is
  'Fiche canonique dont cette ligne est un format de vente (un seul niveau). NULL = fiche du catalogue.';
comment on column public.products.units_per_sale is
  'Unités de base (celles du stock du parent) contenues dans une vente de ce format. 1 pour toute fiche canonique.';
comment on column public.products.format_label is
  'Libellé du format affiché au client (« 1 paquet », « Lot de 3 paquets »). NULL = produit à format unique.';
comment on column public.products.format_position is 'Ordre d''affichage des formats (base = 0).';
comment on column public.products.format_stock_mode is
  'shared : stock dérivé du parent (floor(stock parent / units_per_sale)), jamais écrit à part. own : stock propre (cartons séparés).';

-- Relation calculée PostgREST (`formats:sale_formats(...)`) : les formats actifs
-- d'une fiche, dans la même requête que la card (aucune requête par card).
-- SQL simple, sans SET : intégrable par le planificateur. Lecture soumise à la
-- RLS de `products` comme toute autre lecture.
create or replace function public.sale_formats(public.products)
returns setof public.products
language sql
stable
rows 4
as $$
  select c.*
    from public.products c
   where c.format_parent_id = $1.id
     and c.tenant_id = $1.tenant_id
     and c.active
   order by c.format_position, c.units_per_sale, c.id
$$;

grant execute on function public.sale_formats(public.products) to anon, authenticated, service_role;

-- ─── 2. Cohérence et héritage (enfant) ───────────────────────────────────────
-- Un seul niveau, même tenant (FK), conservation / mode de réception / catégorie
-- / nom hérités du parent, stock dérivé en mode shared.
create or replace function public.products_sale_format_inherit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p record;
  v_expected integer;
begin
  if new.format_parent_id is null then
    if tg_op = 'UPDATE' and old.format_parent_id is not null then
      new.units_per_sale := 1;
    end if;
    return new;
  end if;

  select pr.id, pr.tenant_id, pr.name, pr.stock, pr.format_parent_id, pr.storage_type,
         pr.fulfillment_policy, pr.category_id
    into p
    from public.products pr
   where pr.id = new.format_parent_id and pr.tenant_id = new.tenant_id;
  if not found then
    raise exception 'format_parent_not_found' using errcode = 'foreign_key_violation';
  end if;
  if p.format_parent_id is not null then
    raise exception 'format_parent_is_format' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.products c where c.format_parent_id = new.id) then
    raise exception 'format_has_formats' using errcode = 'check_violation';
  end if;
  if nullif(btrim(new.format_label), '') is null then
    raise exception 'format_label_required' using errcode = 'check_violation';
  end if;

  new.storage_type := p.storage_type;
  new.fulfillment_policy := p.fulfillment_policy;
  new.category_id := p.category_id;
  new.name := left(p.name || ' — ' || btrim(new.format_label), 300);
  -- Un format ne devient jamais une fiche mise en avant ou un « petit plus ».
  new.featured := false;

  if new.format_stock_mode = 'shared' then
    v_expected := floor(greatest(p.stock, 0)::numeric / new.units_per_sale)::integer;
    if tg_op = 'UPDATE' and new.stock is distinct from old.stock and new.stock is distinct from v_expected
       and old.format_parent_id is not distinct from new.format_parent_id
       and old.units_per_sale = new.units_per_sale and old.format_stock_mode = 'shared' then
      raise exception 'format_stock_is_derived:%', new.id using errcode = 'check_violation';
    end if;
    new.stock := v_expected;
  end if;
  return new;
end
$$;

revoke all on function public.products_sale_format_inherit() from public, anon, authenticated, service_role;

drop trigger if exists products_sale_format_inherit on public.products;
create trigger products_sale_format_inherit
  before insert or update on public.products
  for each row
  when (new.format_parent_id is not null or new.units_per_sale <> 1)
  execute function public.products_sale_format_inherit();

-- ─── 3. Propagation (parent → enfants) ───────────────────────────────────────
-- Même transaction que la modification du parent (décrément de commande,
-- réception Gestion, éditeur) : les enfants shared suivent le stock, tous
-- suivent le nom, la conservation, le mode de réception et la catégorie.
-- Ordre de verrouillage toujours parent → enfants : pas d'interblocage.
create or replace function public.products_sale_format_propagate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.format_parent_id is not null then
    return null;
  end if;
  if exists (select 1 from public.products c where c.format_parent_id = new.id) then
    if new.storage_type is distinct from old.storage_type
       or new.fulfillment_policy is distinct from old.fulfillment_policy
       or new.category_id is distinct from old.category_id
       or new.name is distinct from old.name then
      -- Le trigger d'héritage recalcule nom, conservation, réception, catégorie et stock.
      update public.products c set format_label = c.format_label
       where c.format_parent_id = new.id and c.tenant_id = new.tenant_id;
    elsif new.stock is distinct from old.stock then
      update public.products c
         set stock = floor(greatest(new.stock, 0)::numeric / c.units_per_sale)::integer
       where c.format_parent_id = new.id and c.tenant_id = new.tenant_id
         and c.format_stock_mode = 'shared'
         and c.stock is distinct from floor(greatest(new.stock, 0)::numeric / c.units_per_sale)::integer;
    end if;
  end if;
  return null;
end
$$;

revoke all on function public.products_sale_format_propagate() from public, anon, authenticated, service_role;

drop trigger if exists products_sale_format_propagate on public.products;
create trigger products_sale_format_propagate
  after update of stock, name, storage_type, fulfillment_policy, category_id on public.products
  for each row
  when (new.format_parent_id is null and (
    new.stock is distinct from old.stock or new.name is distinct from old.name
    or new.storage_type is distinct from old.storage_type
    or new.fulfillment_policy is distinct from old.fulfillment_policy
    or new.category_id is distinct from old.category_id))
  execute function public.products_sale_format_propagate();

-- ─── 4. Décrément atomique agrégé par stock ──────────────────────────────────
-- Même signature, mêmes appelants (checkout en boutique, webhook Stripe,
-- RPC 128), même erreur `insufficient_stock:<product_id>`. Chaque ligne est
-- ramenée à (stock qui fait foi, unités de base) puis additionnée par stock :
-- un seul UPDATE … WHERE stock >= besoin par stock, dans l'ordre des id
-- (verrous toujours pris dans le même ordre). Tout ou rien. Pour un produit
-- sans format : stock = lui-même, unités = quantité → résultat identique à 029.
create or replace function public.decrement_stock_for_order(items jsonb)
returns void
language plpgsql
as $$
declare
  r        record;
  affected int;
begin
  for r in
    with requested as (
      select x.product_id, x.quantity
        from jsonb_to_recordset(items) as x(product_id uuid, quantity int)
    ),
    resolved as (
      select q.product_id as requested_id,
             case when p.format_parent_id is not null and p.format_stock_mode = 'shared'
                  then p.format_parent_id else q.product_id end as stock_id,
             q.quantity * case when p.format_parent_id is not null and p.format_stock_mode = 'shared'
                               then p.units_per_sale else 1 end as units
        from requested q
        left join public.products p on p.id = q.product_id
    )
    select stock_id, sum(units)::int as units, (array_agg(requested_id order by requested_id))[1] as first_requested
      from resolved
     group by stock_id
     order by stock_id
  loop
    update public.products
       set stock = stock - r.units
     where id = r.stock_id
       and stock >= r.units;

    get diagnostics affected = row_count;
    if affected = 0 then
      raise exception 'insufficient_stock:%', r.first_requested;
    end if;
  end loop;
end;
$$;

comment on function public.decrement_stock_for_order(jsonb) is
  'Décrémente le stock de plusieurs produits atomiquement (tout ou rien). items = [{"product_id": "...", "quantity": N}]. '
  'Les formats en stock partagé (187) sont ramenés au stock du parent × units_per_sale et additionnés par stock. '
  'Lève "insufficient_stock:<product_id>". Appelée par /api/checkout, /api/webhooks/stripe et convert_checkout_session_to_order.';

grant execute on function public.decrement_stock_for_order(jsonb) to service_role;

-- ─── 5. Snapshot de la ligne de commande (162 v2) ────────────────────────────
-- Ajoute le format acheté (libellé, unités par vente, stock qui fait foi) au
-- snapshot figé à l'insertion. Mêmes garanties que 162 : fail-open, même nom,
-- immuable (trigger 162 inchangé), aucun backfill.
create or replace function public.order_items_capture_format_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
  v_is_format boolean;
begin
  if new.format_snapshot is not null or new.product_id is null then
    return new;
  end if;
  begin
    -- Un format enfant décrit son unité de base avec les champs de sa fiche
    -- (« paquet », « 500 g ») : le document dit « Lot de 3 paquets · 3 × 500 g ».
    select pr.name,
           coalesce(pr.sale_unit, pa.sale_unit) as sale_unit,
           case when pr.net_content_value is null then pa.net_content_value else pr.net_content_value end as net_content_value,
           case when pr.net_content_value is null then pa.net_content_unit else pr.net_content_unit end as net_content_unit,
           pr.pack_count,
           coalesce(nullif(btrim(pr.net_quantity_display), ''), pa.net_quantity_display) as net_quantity_display,
           pr.format_parent_id, pr.units_per_sale, pr.format_label, pr.format_stock_mode
      into p
      from public.products pr
      left join public.products pa on pa.id = pr.format_parent_id and pa.tenant_id = pr.tenant_id
     where pr.id = new.product_id
       and pr.tenant_id = new.tenant_id;
    v_is_format := found and nullif(btrim(p.format_label), '') is not null;
    if found
       and p.name = new.name
       and (v_is_format or p.sale_unit is not null or p.net_content_value is not null or p.pack_count is not null
            or nullif(btrim(p.net_quantity_display), '') is not null) then
      new.format_snapshot := jsonb_strip_nulls(jsonb_build_object(
        'v', case when v_is_format then 2 else 1 end,
        'sale_unit', p.sale_unit,
        'net_content_value', p.net_content_value,
        'net_content_unit', p.net_content_unit,
        'pack_count', p.pack_count,
        'net_quantity_display', nullif(btrim(p.net_quantity_display), ''),
        'format_label', case when v_is_format then btrim(p.format_label) end,
        'units_per_sale', case when v_is_format then p.units_per_sale end,
        'stock_product_id', case when v_is_format and p.format_parent_id is not null and p.format_stock_mode = 'shared'
                                 then p.format_parent_id end
      ));
    end if;
  exception when others then
    new.format_snapshot := null;
  end;
  return new;
end
$$;

revoke all on function public.order_items_capture_format_snapshot() from public, anon, authenticated, service_role;

-- ─── 6. Écriture des formats (admin) ─────────────────────────────────────────
-- Liste complète, atomique. p_formats = [{ id?, label, units_per_sale, price,
-- weight_grams, active, slug (nouveau format), stock_mode }]. L'ordre du
-- tableau = ordre d'affichage. Un format absent de la liste est mis hors
-- vente, jamais supprimé (historique des commandes). Le prix d'un format en
-- promotion ne se change pas ici (fiche du format).
create or replace function public.set_product_sale_formats(
  p_tenant_id  uuid,
  p_product_id uuid,
  p_base_label text,
  p_formats    jsonb
)
returns table (out_id uuid, out_created boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent   public.products%rowtype;
  v_item     jsonb;
  v_pos      integer := 0;
  v_id       uuid;
  v_label    text;
  v_units    integer;
  v_price    numeric(10,2);
  v_weight   integer;
  v_active   boolean;
  v_mode     text;
  v_slug     text;
  v_kept     uuid[] := '{}';
  v_child    public.products%rowtype;
  v_labels   text[] := '{}';
begin
  if p_tenant_id is null or p_product_id is null or jsonb_typeof(coalesce(p_formats, '[]'::jsonb)) <> 'array' then
    raise exception 'formats_invalid_input';
  end if;
  if jsonb_array_length(p_formats) > 8 then
    raise exception 'formats_too_many';
  end if;

  select * into v_parent from public.products
   where id = p_product_id and tenant_id = p_tenant_id
   for update;
  if not found or v_parent.format_parent_id is not null then
    raise exception 'format_parent_not_found';
  end if;

  if jsonb_array_length(p_formats) > 0 and nullif(btrim(p_base_label), '') is null then
    raise exception 'format_base_label_required';
  end if;
  if nullif(btrim(p_base_label), '') is not null then
    v_labels := array[lower(btrim(p_base_label))];
  end if;

  update public.products
     set format_label = case when jsonb_array_length(p_formats) > 0 or exists (
                               select 1 from public.products c where c.format_parent_id = p_product_id and c.active)
                             then nullif(btrim(p_base_label), '') else null end,
         format_position = 0
   where id = p_product_id and tenant_id = p_tenant_id;

  for v_item in select value from jsonb_array_elements(p_formats)
  loop
    v_pos := v_pos + 1;
    v_label := nullif(btrim(v_item->>'label'), '');
    v_units := (v_item->>'units_per_sale')::integer;
    v_price := round((v_item->>'price')::numeric, 2);
    v_weight := nullif(v_item->>'weight_grams', '')::integer;
    v_active := coalesce((v_item->>'active')::boolean, true);
    v_mode := coalesce(nullif(v_item->>'stock_mode', ''), 'shared');
    v_id := nullif(v_item->>'id', '')::uuid;

    if v_label is null or char_length(v_label) > 60 then raise exception 'format_label_required'; end if;
    if lower(v_label) = any (v_labels) then raise exception 'format_label_duplicate'; end if;
    v_labels := v_labels || lower(v_label);
    if v_units is null or v_units < 2 or v_units > 999 then raise exception 'format_units_invalid'; end if;
    if v_price is null or v_price <= 0 then raise exception 'format_price_invalid'; end if;
    if v_weight is not null and v_weight < 0 then raise exception 'format_weight_invalid'; end if;
    if v_mode not in ('shared', 'own') then raise exception 'format_stock_mode_invalid'; end if;

    if v_id is not null then
      select * into v_child from public.products
       where id = v_id and tenant_id = p_tenant_id and format_parent_id = p_product_id
       for update;
      if not found then raise exception 'format_not_found'; end if;
      if v_child.price is distinct from v_price
         and (v_child.promo_applied or v_child.promo_price is not null or v_child.compare_at_price is not null) then
        raise exception 'format_price_promotion_active';
      end if;
      update public.products
         set format_label = v_label,
             units_per_sale = v_units,
             price = v_price,
             weight_grams = v_weight,
             active = v_active,
             format_position = v_pos,
             format_stock_mode = v_mode,
             updated_at = now()
       where id = v_id;
      v_kept := v_kept || v_id;
      out_id := v_id; out_created := false;
      return next;
    else
      v_slug := nullif(btrim(v_item->>'slug'), '');
      if v_slug is null or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then raise exception 'format_slug_invalid'; end if;
      insert into public.products (
        tenant_id, category_id, name, slug, description, price, image_url, images, weight_grams, stock,
        active, featured, storage_type, is_homemade, country_of_origin, gluten_free_certified,
        ingredients_text, allergens_text, usage_instructions, conservation_instructions, conservation_after_opening,
        min_order_quantity, order_quantity_step, fulfillment_policy,
        format_parent_id, units_per_sale, format_label, format_position, format_stock_mode
      ) values (
        p_tenant_id, v_parent.category_id, v_parent.name, v_slug, v_parent.description, v_price,
        v_parent.image_url, v_parent.images, v_weight, 0,
        v_active, false, v_parent.storage_type, v_parent.is_homemade, v_parent.country_of_origin,
        v_parent.gluten_free_certified, v_parent.ingredients_text, v_parent.allergens_text,
        v_parent.usage_instructions, v_parent.conservation_instructions, v_parent.conservation_after_opening,
        1, 1, v_parent.fulfillment_policy,
        p_product_id, v_units, v_label, v_pos, v_mode
      )
      returning id into v_id;
      v_kept := v_kept || v_id;
      out_id := v_id; out_created := true;
      return next;
    end if;
  end loop;

  update public.products
     set active = false, updated_at = now()
   where tenant_id = p_tenant_id and format_parent_id = p_product_id
     and active and not (id = any (v_kept));

  if not exists (select 1 from public.products c where c.format_parent_id = p_product_id and c.active) then
    update public.products set format_label = null where id = p_product_id and tenant_id = p_tenant_id;
  end if;
end
$$;

revoke all on function public.set_product_sale_formats(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.set_product_sale_formats(uuid, uuid, text, jsonb) to service_role;

-- ─── 7. Classement du catalogue (109) : une ligne par fiche ──────────────────
-- Les formats enfants ne sont jamais des résultats ; leurs ventes comptent
-- pour leur fiche, en unités de base.
create or replace function public.catalog_ranked_product_ids(
  p_tenant_id uuid,
  p_category_id uuid default null,
  p_query text default '',
  p_sort text default 'recommended',
  p_day date default current_date,
  p_offset integer default 0,
  p_limit integer default 24
)
returns table (product_id uuid, total_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with eligible as (
    select p.id, p.category_id, p.position, p.featured, p.created_at,
           p.price, p.compare_at_price, p.stock
    from public.products p
    join public.categories c on c.id = p.category_id
      and c.tenant_id = p_tenant_id and c.catalog_scope = 'shop'
    where p.tenant_id = p_tenant_id and p.active = true
      and p.format_parent_id is null
      and (p_category_id is null or p.category_id = p_category_id)
      and (coalesce(btrim(p_query), '') = ''
        or p.name ilike '%' || left(btrim(p_query), 100) || '%')
  ),
  recent_sales as (
    select coalesce(sp.format_parent_id, oi.product_id) as product_id,
           sum(oi.quantity * coalesce(sp.units_per_sale, 1))::numeric as units
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
      and oi.tenant_id = p_tenant_id
    left join public.products sp on sp.id = oi.product_id and sp.tenant_id = p_tenant_id
    where o.tenant_id = p_tenant_id
      and p_sort in ('recommended', 'bestsellers')
      and o.payment_status = 'paid' and o.is_test = false
      and o.status not in ('cancelled', 'stock_conflict')
      -- Completed UTC days avoid mid-session reordering when orders arrive.
      and o.created_at >= (p_day - 30)::timestamp at time zone 'UTC'
      and o.created_at < p_day::timestamp at time zone 'UTC'
    group by 1
  ),
  scored as (
    select e.*, coalesce(s.units, 0) as units,
      least(35::numeric, 10 * ln(1 + coalesce(s.units, 0)))
      + case when e.position < 9999
          then 25 * (1 - least(100, greatest(0, e.position))::numeric / 100)
          else 0 end
      + case when e.featured then 10 else 0 end
      + case when e.created_at >= p_day - 14
          then 15 * (1 - greatest(0, (p_day - e.created_at::date))::numeric / 14)
          else 0 end
      + case when e.compare_at_price > e.price and e.price > 0
          then least(10::numeric, 40 * (e.compare_at_price - e.price) / e.compare_at_price)
          else 0 end
      + case when e.stock > 0 then 10 else 0 end as score
    from eligible e left join recent_sales s on s.product_id = e.id
  ),
  diverse as (
    select *,
      row_number() over (partition by category_id order by score desc, position, id) as category_rank
    from scored
  ),
  ranked as (
    select id, stock, row_number() over (
      order by
        case when stock > 0 then 0 else 1 end,
        case when p_sort = 'bestsellers' then units end desc nulls last,
        case when p_sort = 'newest' then created_at end desc nulls last,
        case when p_sort = 'price_asc' then price end asc nulls last,
        case when p_sort = 'price_desc' then price end desc nulls last,
        case when p_sort = 'recommended'
          then score - least(8::numeric, 2 * (category_rank - 1)) end desc nulls last,
        position asc, id asc
    ) as rank_no
    from diverse
  ),
  discovery as (
    select id, row_number() over (order by md5(id::text || p_day::text || p_tenant_id::text)) as slot_no
    from ranked
    where p_sort = 'recommended' and stock > 0 and rank_no between 25 and 120
    order by md5(id::text || p_day::text || p_tenant_id::text)
    limit 6
  ),
  baseline as (
    select r.id, row_number() over (order by r.rank_no) as base_no
    from ranked r
    where not exists (select 1 from discovery d where d.id = r.id)
  ),
  ordered as (
    select id, base_no + (base_no - 1) / 19 as slot from baseline
    union all
    select id, slot_no * 20 as slot from discovery
  ),
  result as (
    select id, count(*) over () as total
    from ordered
    order by slot, id
    offset greatest(0, p_offset)
    limit least(2400, greatest(1, p_limit))
  )
  select id, total from result
$$;

-- ─── 8. match_products (156) : jamais un format enfant ───────────────────────
do $migration$
begin
  if not exists (select 1 from pg_type where typname = 'vector') then
    raise notice '187: pgvector absent, match_products unchanged';
    return;
  end if;

  execute 'drop function if exists public.match_products(vector, uuid, int, float)';
  execute $fn$
    create function public.match_products(
      query_embedding vector(768),
      p_tenant_id     uuid,
      match_count     int   default 8,
      min_similarity  float default 0.35
    )
    returns table (
      id                   uuid,
      name                 text,
      slug                 text,
      price                numeric,
      image_url            text,
      category_id          uuid,
      category_name        text,
      stock                int,
      weight_grams         int,
      storage_type         text,
      min_order_quantity   int,
      order_quantity_step  int,
      net_quantity_display text,
      sale_unit            text,
      net_content_value    numeric,
      net_content_unit     text,
      pack_count           int,
      fulfillment_policy   text,
      promo_ends_at        timestamptz,
      promo_until_sold_out boolean,
      new_until            timestamptz,
      similarity           float
    )
    language sql
    stable
    as $body$
      select
        p.id, p.name, p.slug, p.price, p.image_url, p.category_id,
        c.name as category_name,
        p.stock, p.weight_grams, p.storage_type,
        p.min_order_quantity, p.order_quantity_step,
        p.net_quantity_display, p.sale_unit, p.net_content_value, p.net_content_unit, p.pack_count,
        p.fulfillment_policy,
        case when p.promo_applied then p.promo_ends_at end,
        p.promo_applied and p.promo_until_sold_out,
        p.new_until,
        1 - (p.embedding <=> query_embedding) as similarity
      from public.products p
      left join public.categories c on c.id = p.category_id
      where p.tenant_id = p_tenant_id
        and p.active = true
        and p.format_parent_id is null
        and p.embedding is not null
        and 1 - (p.embedding <=> query_embedding) >= min_similarity
      order by p.embedding <=> query_embedding
      limit match_count;
    $body$
  $fn$;
  execute 'grant execute on function public.match_products(vector, uuid, int, float) to anon';
  execute 'grant execute on function public.match_products(vector, uuid, int, float) to service_role';
end
$migration$;

-- ─── 9. Journal d'activité (156 §6) : les champs de format suivent la fiche ──
create or replace function public.audit_products_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n        jsonb;
  o        jsonb;
  v_row    jsonb := to_jsonb(coalesce(new, old));
  v_tenant uuid := (v_row->>'tenant_id')::uuid;
  v_id     text := v_row->>'id';
  v_label  text := left(v_row->>'name', 160);
  v_diff   jsonb;
  v_ctx    jsonb;
begin
  begin
    if tg_op = 'INSERT' then
      n := to_jsonb(new);
      perform public.audit_emit(false, v_tenant, 'catalog.product.created', 'product', v_id, v_label, '[]'::jsonb,
        jsonb_build_object('price', n->'price', 'active', n->'active', 'stock', n->'stock'));
      return null;
    elsif tg_op = 'DELETE' then
      perform public.audit_emit(false, v_tenant, 'catalog.product.deleted', 'product', v_id, v_label, '[]'::jsonb, '{}'::jsonb);
      return null;
    end if;

    n := to_jsonb(new);
    o := to_jsonb(old);
    v_diff := public.audit_diff(o, n,
      array['price', 'compare_at_price', 'promo_price', 'promo_starts_at', 'promo_ends_at', 'promo_until_sold_out', 'promo_applied'],
      array['price', 'compare_at_price', 'promo_price', 'promo_starts_at', 'promo_ends_at', 'promo_until_sold_out', 'promo_applied']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.price_updated', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
    v_diff := public.audit_diff(o, n, array['active'], array['active']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.availability_changed', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
    v_diff := public.audit_diff(o, n, array['min_order_quantity', 'order_quantity_step'], array['min_order_quantity', 'order_quantity_step']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.quantity_rule_changed', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
    if (o->'stock') is distinct from (n->'stock') then
      v_ctx := public.audit_request_context();
      -- Le stock dérivé d'un format suit son parent : seul le parent est journalisé.
      if v_ctx->>'actor_type' in ('admin', 'platform_owner')
         and not (n->>'format_parent_id' is not null and n->>'format_stock_mode' = 'shared') then
        perform public.audit_emit(false, v_tenant, 'catalog.product.stock_adjusted', 'product', v_id, v_label,
          public.audit_diff(o, n, array['stock'], array['stock']), '{}'::jsonb);
      end if;
    end if;
    v_diff := public.audit_diff(o, n,
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified', 'description', 'image_url', 'images',
            'ingredients_text', 'allergens_text', 'usage_instructions', 'conservation_instructions', 'conservation_after_opening',
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count', 'fulfillment_policy', 'new_until',
            'format_parent_id', 'units_per_sale', 'format_label', 'format_position', 'format_stock_mode'],
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified',
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count', 'fulfillment_policy', 'new_until',
            'format_parent_id', 'units_per_sale', 'format_label', 'format_position', 'format_stock_mode']);
    if jsonb_array_length(v_diff) > 0 then
      perform public.audit_emit(false, v_tenant, 'catalog.product.updated', 'product', v_id, v_label, v_diff, '{}'::jsonb);
    end if;
  exception when others then
    perform public.audit_note_failure(v_tenant, 'catalog.*', sqlstate, sqlerrm);
  end;
  return null;
end
$$;

revoke all on function public.audit_products_trigger() from public, anon, authenticated, service_role;

drop trigger if exists audit_products_update on public.products;
create trigger audit_products_update after update on public.products
  for each row
  when (
    (old.price, old.compare_at_price, old.active, old.min_order_quantity, old.order_quantity_step, old.stock,
     old.name, old.name_alt, old.slug, old.category_id, old.featured, old.weight_grams, old.storage_type,
     old.is_homemade, old.country_of_origin, old.net_quantity_display, old.gluten_free_certified,
     old.description, old.image_url, old.images, old.ingredients_text, old.allergens_text, old.usage_instructions,
     old.conservation_instructions, old.conservation_after_opening,
     old.sale_unit, old.net_content_value, old.net_content_unit, old.pack_count, old.fulfillment_policy,
     old.promo_price, old.promo_starts_at, old.promo_ends_at, old.promo_until_sold_out, old.promo_applied, old.new_until,
     old.format_parent_id, old.units_per_sale, old.format_label, old.format_position, old.format_stock_mode)
    is distinct from
    (new.price, new.compare_at_price, new.active, new.min_order_quantity, new.order_quantity_step, new.stock,
     new.name, new.name_alt, new.slug, new.category_id, new.featured, new.weight_grams, new.storage_type,
     new.is_homemade, new.country_of_origin, new.net_quantity_display, new.gluten_free_certified,
     new.description, new.image_url, new.images, new.ingredients_text, new.allergens_text, new.usage_instructions,
     new.conservation_instructions, new.conservation_after_opening,
     new.sale_unit, new.net_content_value, new.net_content_unit, new.pack_count, new.fulfillment_policy,
     new.promo_price, new.promo_starts_at, new.promo_ends_at, new.promo_until_sold_out, new.promo_applied, new.new_until,
     new.format_parent_id, new.units_per_sale, new.format_label, new.format_position, new.format_stock_mode)
  )
  execute function public.audit_products_trigger();

-- PostgREST : nouvelle relation calculée et nouvelles colonnes visibles tout de suite.
notify pgrst, 'reload schema';
