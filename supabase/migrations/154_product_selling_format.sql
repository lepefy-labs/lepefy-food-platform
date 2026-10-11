-- 154_product_selling_format.sql
-- Format de vente structuré affiché au client (« 8,50 € le paquet de 500 g,
-- soit 17,00 € le kilo »), lu par lib/storefrontCopy/sellingFormat.ts.
--
-- Additif et réversible : quatre colonnes nullable, aucun défaut, aucun
-- backfill. NULL = comportement actuel (net_quantity_display lisible, sinon
-- « l'article »). Ne change ni le prix, ni les quantités achetables, ni le
-- poids logistique (weight_grams), ni l'étiquette imprimée
-- (net_quantity_display), qui gardent leur sens.
--
--   sale_unit          clé du registre applicatif (saleUnits.ts : paquet,
--                      sachet, bouteille, carton, kg…). Une nouvelle unité
--                      n'exige pas de migration ; une clé inconnue est ignorée.
--   net_content_value  contenu net d'une unité vendue (500, 1.5, 33…)
--   net_content_unit   g | kg | ml | cl | l
--   pack_count         nombre d'éléments dans l'unité vendue (carton de 12)
--
-- Rollback :
--   alter table public.products drop constraint if exists products_sale_unit_format,
--     drop constraint if exists products_net_content_pair, drop constraint if exists products_net_content_unit,
--     drop constraint if exists products_net_content_value_positive, drop constraint if exists products_pack_count_range;
--   alter table public.products drop column if exists sale_unit, drop column if exists net_content_value,
--     drop column if exists net_content_unit, drop column if exists pack_count;
--   puis réappliquer la section 7 de 153 (trigger) et 122 (match_products).

-- ─── 1. Colonnes ─────────────────────────────────────────────────────────────
alter table public.products
  add column if not exists sale_unit         text,
  add column if not exists net_content_value numeric(10,3),
  add column if not exists net_content_unit  text,
  add column if not exists pack_count        integer;

alter table public.products drop constraint if exists products_sale_unit_format;
alter table public.products add constraint products_sale_unit_format
  check (sale_unit is null or sale_unit ~ '^[a-z_]{2,24}$');

alter table public.products drop constraint if exists products_net_content_unit;
alter table public.products add constraint products_net_content_unit
  check (net_content_unit is null or net_content_unit in ('g', 'kg', 'ml', 'cl', 'l'));

alter table public.products drop constraint if exists products_net_content_pair;
alter table public.products add constraint products_net_content_pair
  check ((net_content_value is null) = (net_content_unit is null));

alter table public.products drop constraint if exists products_net_content_value_positive;
alter table public.products add constraint products_net_content_value_positive
  check (net_content_value is null or net_content_value > 0);

alter table public.products drop constraint if exists products_pack_count_range;
alter table public.products add constraint products_pack_count_range
  check (pack_count is null or pack_count between 2 and 999);

comment on column public.products.sale_unit is
  'Unité de vente affichée au client (clé de lib/storefrontCopy/saleUnits.ts). NULL = repli sur net_quantity_display.';
comment on column public.products.net_content_value is
  'Contenu net d''une unité vendue, avec net_content_unit. Jamais dérivé de weight_grams (poids logistique).';
comment on column public.products.net_content_unit is 'g | kg | ml | cl | l';
comment on column public.products.pack_count is
  'Nombre d''éléments dans l''unité vendue (ex. carton de 12). NULL si l''unité n''est pas un lot.';

-- ─── 2. Journal d'activité (153) : les nouveaux champs suivent la fiche ──────
-- Même fonction que 153 §7, avec les quatre colonnes dans « catalog.product.updated ».
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
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count'],
      array['name', 'name_alt', 'slug', 'category_id', 'featured', 'weight_grams', 'storage_type', 'is_homemade',
            'country_of_origin', 'net_quantity_display', 'gluten_free_certified',
            'sale_unit', 'net_content_value', 'net_content_unit', 'pack_count']);
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
     old.sale_unit, old.net_content_value, old.net_content_unit, old.pack_count)
    is distinct from
    (new.price, new.compare_at_price, new.active, new.min_order_quantity, new.order_quantity_step, new.stock,
     new.name, new.name_alt, new.slug, new.category_id, new.featured, new.weight_grams, new.storage_type,
     new.is_homemade, new.country_of_origin, new.net_quantity_display, new.gluten_free_certified,
     new.description, new.image_url, new.images, new.ingredients_text, new.allergens_text, new.usage_instructions,
     new.conservation_instructions, new.conservation_after_opening,
     new.sale_unit, new.net_content_value, new.net_content_unit, new.pack_count)
  )
  execute function public.audit_products_trigger();

-- ─── 3. match_products (122) : renvoie aussi le format de vente ─────────────
-- Les cards « ricerca semantica » et Nala affichent ainsi le même prix que le
-- catalogue. Postgres refuse un CREATE OR REPLACE qui change les colonnes de
-- sortie : DROP puis CREATE. Exécuté seulement si le type `vector` existe
-- (production) ; la base de test CI (postgres:16 sans pgvector) vérifie
-- colonnes, contraintes et trigger.
do $migration$
begin
  if not exists (select 1 from pg_type where typname = 'vector') then
    raise notice '154: pgvector absent, match_products unchanged';
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
