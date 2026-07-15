-- 028_semantic_search.sql
-- Ricerca semantica: pgvector + funzione match_products

create extension if not exists vector;

-- 1. Colonna embedding (gemini-embedding-001, 768 dimensioni raccomandate da Google)
alter table public.products
  add column if not exists embedding vector(768);

comment on column public.products.embedding is
  'Embedding gemini-embedding-001 (768 dim) di name + categoria + descriptions (tutte le lingue). Ricalcolato al salvataggio prodotto.';

-- 2. Indice HNSW (cosine)
create index if not exists products_embedding_hnsw_idx
  on public.products
  using hnsw (embedding vector_cosine_ops);

-- 3. Flag tenant
alter table public.tenants
  add column if not exists ai_semantic_search boolean not null default false;

update public.tenants
set ai_semantic_search = true
where slug = 'chloefood';

-- 4. Prezzo embedding in ai_pricing (se non già presente da seed precedenti)
insert into public.ai_pricing (provider, model, input_price_per_million, output_price_per_million, image_price_flat)
values ('gemini', 'gemini-embedding-001', 0.15, null, null)
on conflict (provider, model) do nothing;

-- 5. Funzione di match — filtro tenant e active DENTRO la funzione, mai delegato al client.
-- Colonne allineate a ciò che serve alla card prodotto storefront (ProductCard):
-- nome, slug, prezzo, immagine, stock, peso, tipo stoccaggio, nome categoria.
create or replace function public.match_products(
  query_embedding vector(768),
  p_tenant_id     uuid,
  match_count     int   default 8,
  min_similarity  float default 0.35
)
returns table (
  id            uuid,
  name          text,
  slug          text,
  price         numeric,
  image_url     text,
  category_id   uuid,
  category_name text,
  stock         int,
  weight_grams  int,
  storage_type  text,
  similarity    float
)
language sql
stable
as $$
  select
    p.id, p.name, p.slug, p.price, p.image_url, p.category_id,
    c.name as category_name,
    p.stock, p.weight_grams, p.storage_type,
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

-- 6. Grants espliciti (Supabase richiede GRANT oltre a RLS)
grant execute on function public.match_products(vector, uuid, int, float) to anon;
grant execute on function public.match_products(vector, uuid, int, float) to service_role;
grant select, update on public.products to service_role;
