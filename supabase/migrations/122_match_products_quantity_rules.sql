-- 122_match_products_quantity_rules.sql
-- match_products() (028_semantic_search.sql) alimente toutes les cards
-- "ricerca semantica" du storefront et de Nala. Elle ne renvoyait pas
-- min_order_quantity/order_quantity_step (migration 121), ce qui forçait
-- un aller-retour compensatoire dédié côté Nala (nalaCartPlanResolver.ts)
-- et laissait la ricerca semantica muette sur la règle. Correctif unique,
-- à la source : tous les consommateurs de la RPC héritent des colonnes
-- sans requête supplémentaire ni changement de temps de réponse.

create or replace function public.match_products(
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
  similarity           float
)
language sql
stable
as $$
  select
    p.id, p.name, p.slug, p.price, p.image_url, p.category_id,
    c.name as category_name,
    p.stock, p.weight_grams, p.storage_type,
    p.min_order_quantity, p.order_quantity_step,
    1 - (p.embedding <=> query_embedding) as similarity
  from public.products p
  left join public.categories c on c.id = p.category_id
  where p.tenant_id = p_tenant_id
    and p.active = true
    and p.embedding is not null
    and 1 - (p.embedding <=> query_embedding) >= min_similarity
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_products(vector, uuid, int, float) to anon;
grant execute on function public.match_products(vector, uuid, int, float) to service_role;
