-- 033_ai_chatbox_knowledge_base.sql
-- Base di conoscenza culturale curata a mano — mai generata dall'IA

create table if not exists public.tenant_knowledge_base (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  category     text not null check (category in ('recipe','expression','greeting','cultural_context','faq')),
  content      text not null,
  embedding    vector(768),
  source       text,                     -- es. 'dalice', 'robertin'
  reviewed_by  text,                     -- email admin che ha inserito/validato
  reviewed_at  timestamptz,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.tenant_knowledge_base is
  'Contenuto culturale curato a mano (ricette, espressioni, contesto, FAQ) usato dal
  chatbox come esempio di stile/tono autentico. Il contenuto testuale è sempre scritto
  da una persona reale — mai generato o modificato dall''IA. L''IA lo recupera via
  similarità semantica e lo usa come riferimento, non come istruzione astratta.';

create index if not exists tenant_knowledge_base_embedding_hnsw_idx
  on public.tenant_knowledge_base
  using hnsw (embedding vector_cosine_ops);

create index if not exists tenant_knowledge_base_tenant_idx
  on public.tenant_knowledge_base (tenant_id, active);

alter table public.tenant_knowledge_base enable row level security;
-- Nessuna policy per anon/authenticated: accesso solo tramite service_role
-- (route admin per la scrittura, route chatbox per la lettura via match).

create or replace function public.match_knowledge_base(
  query_embedding vector(768),
  p_tenant_id     uuid,
  match_count     int   default 3,
  min_similarity  float default 0.35
)
returns table (
  id         uuid,
  category   text,
  content    text,
  similarity float
)
language sql
stable
as $$
  select
    k.id, k.category, k.content,
    1 - (k.embedding <=> query_embedding) as similarity
  from public.tenant_knowledge_base k
  where k.tenant_id = p_tenant_id
    and k.active = true
    and k.embedding is not null
    and 1 - (k.embedding <=> query_embedding) >= min_similarity
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function public.match_knowledge_base(vector, uuid, int, float) to service_role;
grant select, insert, update, delete on public.tenant_knowledge_base to service_role;
