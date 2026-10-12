-- 155_product_fulfillment_policy.sql
-- Mode de réception d'un produit : comment le client peut le recevoir.
-- Lu par lib/fulfillment/fulfillmentPolicy.ts (moteur unique panier/checkout,
-- client et serveur) et appliqué côté serveur par validateCheckoutItems dans
-- chaque chemin de paiement.
--
--   delivery_or_pickup  défaut : livraison ou retrait, selon la boutique
--   pickup_only         la commande entière doit être retirée en boutique
--   delivery_only       la commande entière doit être livrée
--
-- Indépendant de storage_type (conservation) : jamais dérivé de lui.
--
-- Additif et réversible : une colonne NOT NULL avec défaut, aucun backfill
-- explicite (le défaut s'applique aux lignes existantes = comportement actuel).
--
-- Rollback :
--   alter table public.products drop constraint if exists products_fulfillment_policy_check;
--   alter table public.products drop column if exists fulfillment_policy;
--   puis réappliquer 154 (trigger d'audit et match_products).

-- ─── 1. Colonne ──────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists fulfillment_policy text not null default 'delivery_or_pickup';

alter table public.products drop constraint if exists products_fulfillment_policy_check;
alter table public.products add constraint products_fulfillment_policy_check
  check (fulfillment_policy in ('delivery_or_pickup', 'pickup_only', 'delivery_only'));

comment on column public.products.fulfillment_policy is
  'Mode de réception : delivery_or_pickup (défaut) | pickup_only | delivery_only. Appliqué au checkout serveur (lib/fulfillment/fulfillmentPolicy.ts). Jamais dérivé de storage_type.';

-- ─── 2. Journal d'activité (153/154) : le mode de réception suit la fiche ────
-- Même fonction que 154 §2, avec fulfillment_policy dans « catalog.product.updated ».
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
    v_diff := public.audit_diff(o, n, array['price', 'compare_at_price'], array['price', 'compare_at_price']);
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
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count', 'fulfillment_policy'],
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified',
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count', 'fulfillment_policy']);
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
     old.sale_unit, old.net_content_value, old.net_content_unit, old.pack_count, old.fulfillment_policy)
    is distinct from
    (new.price, new.compare_at_price, new.active, new.min_order_quantity, new.order_quantity_step, new.stock,
     new.name, new.name_alt, new.slug, new.category_id, new.featured, new.weight_grams, new.storage_type,
     new.is_homemade, new.country_of_origin, new.net_quantity_display, new.gluten_free_certified,
     new.description, new.image_url, new.images, new.ingredients_text, new.allergens_text, new.usage_instructions,
     new.conservation_instructions, new.conservation_after_opening,
     new.sale_unit, new.net_content_value, new.net_content_unit, new.pack_count, new.fulfillment_policy)
  )
  execute function public.audit_products_trigger();

-- ─── 3. match_products (154) : renvoie aussi le mode de réception ───────────
-- Les cards « recherche sémantique » et Nala affichent ainsi la même mention
-- que le catalogue. DROP puis CREATE (colonnes de sortie modifiées), exécuté
-- seulement si le type `vector` existe (production).
do $migration$
begin
  if not exists (select 1 from pg_type where typname = 'vector') then
    raise notice '155: pgvector absent, match_products unchanged';
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
