-- 156_product_promotions_novelties.sql
-- Promotions programmées (début / fin / jusqu'à épuisement des stocks) et
-- nouveautés à durée limitée.
--
-- Principe : `products.price` reste TOUJOURS le prix payé, lu tel quel par le
-- checkout (validateCheckoutItems), le panier, Nala, /card… Aucun lecteur ne
-- calcule de prix « à la volée ». Une promotion programmée est décrite par
-- les colonnes promo_* ; elle est APPLIQUÉE en écrivant le couple existant
--   price = promo_price, compare_at_price = prix normal, promo_applied = true
-- puis RETIRÉE en restaurant
--   price = prix normal, compare_at_price = null, promo_* vidées.
--
--   * début / fin à date : public.apply_product_promotion_schedule(),
--     appelée par le tick POST /api/internal/catalog-schedule (n8n, 5 min) ;
--     l'admin applique directement l'état courant à l'enregistrement
--     (lib/catalog/promotionSchedule.ts, même règle).
--   * jusqu'à épuisement des stocks : trigger BEFORE UPDATE OF stock, dans la
--     transaction qui fait passer le stock sous le minimum (checkout compris) :
--     un réassort revient au prix normal.
--   * nouveautés : new_until ; le tick vide les dates passées.
--
-- Les promotions existantes sans date (compare_at_price saisi à la main,
-- promo_price null) ne sont jamais touchées.
--
-- Additif et réversible. Rollback :
--   drop trigger if exists products_end_sold_out_promotion on public.products;
--   drop function if exists public.end_sold_out_promotion();
--   drop function if exists public.apply_product_promotion_schedule(timestamptz);
--   alter table public.products drop constraint if exists products_promo_price_check,
--     drop constraint if exists products_promo_window_check;
--   drop index if exists products_promo_start_due_idx, products_promo_end_due_idx, products_new_until_idx;
--   alter table public.products drop column if exists promo_price, drop column if exists promo_starts_at,
--     drop column if exists promo_ends_at, drop column if exists promo_until_sold_out,
--     drop column if exists promo_applied, drop column if exists new_until;
--   puis réappliquer 155 (trigger d'audit et match_products).

-- ─── 1. Colonnes ─────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists promo_price          numeric(10,2),
  add column if not exists promo_starts_at      timestamptz,
  add column if not exists promo_ends_at        timestamptz,
  add column if not exists promo_until_sold_out boolean not null default false,
  add column if not exists promo_applied        boolean not null default false,
  add column if not exists new_until            timestamptz;

alter table public.products drop constraint if exists products_promo_price_check;
alter table public.products add constraint products_promo_price_check
  check (promo_price is null or promo_price > 0);

alter table public.products drop constraint if exists products_promo_window_check;
alter table public.products add constraint products_promo_window_check
  check (promo_starts_at is null or promo_ends_at is null or promo_ends_at > promo_starts_at);

comment on column public.products.promo_price is
  'Prix promotionnel programmé. Appliqué dans price (prix normal dans compare_at_price) pendant la fenêtre ; null = pas de promotion programmée.';
comment on column public.products.promo_starts_at is 'Début de la promotion programmée (null = dès l''enregistrement).';
comment on column public.products.promo_ends_at is 'Fin de la promotion programmée (null = sans date de fin).';
comment on column public.products.promo_until_sold_out is
  'La promotion se termine quand le stock ne couvre plus le minimum d''achat (trigger products_end_sold_out_promotion).';
comment on column public.products.promo_applied is
  'true : la promotion programmée est en cours (price = promo_price, compare_at_price = prix normal).';
comment on column public.products.new_until is 'Affiché comme nouveauté jusqu''à cette date (null = non).';

create index if not exists products_promo_start_due_idx on public.products (promo_starts_at)
  where promo_price is not null and not promo_applied;
create index if not exists products_promo_end_due_idx on public.products (promo_ends_at)
  where promo_applied;
create index if not exists products_new_until_idx on public.products (tenant_id, new_until)
  where new_until is not null;

-- ─── 2. Fin « jusqu'à épuisement des stocks » ───────────────────────────────
-- Même transaction que la baisse de stock : le prix normal revient avant tout
-- réassort. « Épuisé » = le stock ne couvre plus le minimum d'achat.
create or replace function public.end_sold_out_promotion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.promo_applied and new.promo_until_sold_out
     and new.stock < greatest(coalesce(new.min_order_quantity, 1), 1) then
    new.price := coalesce(new.compare_at_price, new.price);
    new.compare_at_price := null;
    new.promo_applied := false;
    new.promo_price := null;
    new.promo_starts_at := null;
    new.promo_ends_at := null;
    new.promo_until_sold_out := false;
  end if;
  return new;
end
$$;

revoke all on function public.end_sold_out_promotion() from public, anon, authenticated;

drop trigger if exists products_end_sold_out_promotion on public.products;
create trigger products_end_sold_out_promotion
  before update of stock on public.products
  for each row
  when (new.promo_applied and new.promo_until_sold_out)
  execute function public.end_sold_out_promotion();

-- ─── 3. Transitions à date (tick n8n) ────────────────────────────────────────
-- Idempotente, tous tenants (job système). Chaque ligne modifiée est
-- renvoyée pour l'invalidation de cache du déploiement appelant.
create or replace function public.apply_product_promotion_schedule(p_now timestamptz default now())
returns table (out_tenant_id uuid, out_product_id uuid, out_change text)
language plpgsql
set search_path = public
as $$
begin
  -- 1. Promotions en cours arrivées à leur fin : prix normal restauré.
  return query
  update public.products p
     set price = coalesce(p.compare_at_price, p.price),
         compare_at_price = null,
         promo_applied = false,
         promo_price = null,
         promo_starts_at = null,
         promo_ends_at = null,
         promo_until_sold_out = false
   where p.promo_applied
     and p.promo_ends_at is not null
     and p.promo_ends_at <= p_now
  returning p.tenant_id, p.id, 'promo_ended'::text;

  -- 2. Promotions programmées terminées avant d'avoir commencé : abandonnées.
  return query
  update public.products p
     set promo_price = null,
         promo_starts_at = null,
         promo_ends_at = null,
         promo_until_sold_out = false
   where not p.promo_applied
     and p.promo_price is not null
     and p.promo_ends_at is not null
     and p.promo_ends_at <= p_now
  returning p.tenant_id, p.id, 'promo_expired'::text;

  -- 3. Promotions programmées arrivées à leur début : prix promo appliqué,
  --    prix normal barré. Jamais un « prix promo » supérieur ou égal au prix
  --    normal, jamais une promo « jusqu'à épuisement » sans stock.
  return query
  update public.products p
     set compare_at_price = p.price,
         price = p.promo_price,
         promo_applied = true
   where not p.promo_applied
     and p.promo_price is not null
     and (p.promo_starts_at is null or p.promo_starts_at <= p_now)
     and (p.promo_ends_at is null or p.promo_ends_at > p_now)
     and p.promo_price < p.price
     and not (p.promo_until_sold_out and p.stock < greatest(coalesce(p.min_order_quantity, 1), 1))
  returning p.tenant_id, p.id, 'promo_started'::text;

  -- 4. Nouveautés arrivées à échéance.
  return query
  update public.products p
     set new_until = null
   where p.new_until is not null
     and p.new_until <= p_now
  returning p.tenant_id, p.id, 'novelty_ended'::text;
end
$$;

revoke all on function public.apply_product_promotion_schedule(timestamptz) from public, anon, authenticated;
grant execute on function public.apply_product_promotion_schedule(timestamptz) to service_role;

comment on function public.apply_product_promotion_schedule(timestamptz) is
  'Transitions à date des promotions programmées et des nouveautés (tous tenants). Appelée par /api/internal/catalog-schedule (n8n).';

-- ─── 4. Journal d'activité (153/154/155) : promotions et nouveautés ─────────
-- Même fonction que 155 §2 : les champs promo_* rejoignent
-- « catalog.product.price_updated », new_until « catalog.product.updated ».
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
      if v_ctx->>'actor_type' in ('admin', 'platform_owner') then
        perform public.audit_emit(false, v_tenant, 'catalog.product.stock_adjusted', 'product', v_id, v_label,
          public.audit_diff(o, n, array['stock'], array['stock']), '{}'::jsonb);
      end if;
    end if;
    v_diff := public.audit_diff(o, n,
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified', 'description', 'image_url', 'images',
            'ingredients_text', 'allergens_text', 'usage_instructions', 'conservation_instructions', 'conservation_after_opening',
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count', 'fulfillment_policy', 'new_until'],
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified',
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count', 'fulfillment_policy', 'new_until']);
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
     old.promo_price, old.promo_starts_at, old.promo_ends_at, old.promo_until_sold_out, old.promo_applied, old.new_until)
    is distinct from
    (new.price, new.compare_at_price, new.active, new.min_order_quantity, new.order_quantity_step, new.stock,
     new.name, new.name_alt, new.slug, new.category_id, new.featured, new.weight_grams, new.storage_type,
     new.is_homemade, new.country_of_origin, new.net_quantity_display, new.gluten_free_certified,
     new.description, new.image_url, new.images, new.ingredients_text, new.allergens_text, new.usage_instructions,
     new.conservation_instructions, new.conservation_after_opening,
     new.sale_unit, new.net_content_value, new.net_content_unit, new.pack_count, new.fulfillment_policy,
     new.promo_price, new.promo_starts_at, new.promo_ends_at, new.promo_until_sold_out, new.promo_applied, new.new_until)
  )
  execute function public.audit_products_trigger();

-- ─── 5. match_products (155) : fin de promotion et nouveauté ────────────────
-- Les cards « recherche sémantique » et Nala affichent les mêmes mentions que
-- le catalogue. DROP puis CREATE (colonnes de sortie modifiées), seulement si
-- le type `vector` existe (production).
do $migration$
begin
  if not exists (select 1 from pg_type where typname = 'vector') then
    raise notice '156: pgvector absent, match_products unchanged';
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
