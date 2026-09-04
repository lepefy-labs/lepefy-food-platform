-- 102_nala_response_memory.sql
-- Lepefy Response Memory V1: tenant-scoped operational reuse of safe external answers.
-- Additive and fail-open at application level until applied remotely.

begin;

-- Knowledge rows need a revision signal so response memory can be invalidated when
-- tenant-approved knowledge changes. Existing rows are backfilled without changing content.
alter table public.tenant_knowledge_base
  add column if not exists updated_at timestamptz;

update public.tenant_knowledge_base
set updated_at = coalesce(reviewed_at, created_at, now())
where updated_at is null;

alter table public.tenant_knowledge_base
  alter column updated_at set default now();
alter table public.tenant_knowledge_base
  alter column updated_at set not null;

create or replace function public.touch_tenant_knowledge_base_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;

drop trigger if exists touch_tenant_knowledge_base_updated_at on public.tenant_knowledge_base;
create trigger touch_tenant_knowledge_base_updated_at
  before update on public.tenant_knowledge_base
  for each row execute function public.touch_tenant_knowledge_base_updated_at();

revoke all on function public.touch_tenant_knowledge_base_updated_at() from public, anon, authenticated;

create table public.nala_response_memory (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  locale text not null check (char_length(locale) between 2 and 35),
  query_family text not null check (query_family in (
    'definition','recipe','storage','use','delivery','store_info','general'
  )),
  normalized_query text not null check (char_length(normalized_query) between 1 and 500),
  query_terms text[] not null check (cardinality(query_terms) between 1 and 24),
  intent text not null check (char_length(intent) between 1 and 50),
  subject_key text check (subject_key is null or char_length(subject_key) <= 150),
  reply text not null check (char_length(reply) between 1 and 2000),
  decision jsonb not null check (jsonb_typeof(decision) = 'object'),
  tenant_version timestamptz not null,
  knowledge_revision text not null check (char_length(knowledge_revision) <= 120),
  context_product_versions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context_product_versions) = 'object'),
  context_kb_versions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(context_kb_versions) = 'object'),
  context_fingerprint text not null check (context_fingerprint ~ '^[a-f0-9]{64}$'),
  source_interaction_id uuid,
  source_provider text not null check (char_length(source_provider) between 1 and 100),
  source_model text not null check (char_length(source_model) between 1 and 160),
  active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '30 days'),
  hit_count bigint not null default 0 check (hit_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nala_response_memory_query_unique unique (tenant_id, locale, normalized_query)
);

create index nala_response_memory_lookup_idx
  on public.nala_response_memory (tenant_id, locale, query_family, active, expires_at);
create index nala_response_memory_terms_gin_idx
  on public.nala_response_memory using gin (query_terms);
create index nala_response_memory_expiry_idx
  on public.nala_response_memory (expires_at);

create or replace function public.touch_nala_response_memory(
  p_tenant_id uuid,
  p_memory_id uuid
) returns void
language sql
security definer
set search_path = public
as $$
  update public.nala_response_memory
  set hit_count = hit_count + 1,
      last_used_at = now(),
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = p_memory_id
    and active = true
    and expires_at > now();
$$;

create or replace function public.purge_expired_nala_response_memory()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.nala_response_memory
  where expires_at <= now()
     or (active = false and updated_at < now() - interval '7 days');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

alter table public.nala_response_memory enable row level security;
revoke all on public.nala_response_memory from public, anon, authenticated;
grant select, insert, update, delete on public.nala_response_memory to service_role;

revoke all on function public.touch_nala_response_memory(uuid, uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_nala_response_memory() from public, anon, authenticated;
grant execute on function public.touch_nala_response_memory(uuid, uuid) to service_role;
grant execute on function public.purge_expired_nala_response_memory() to service_role;

comment on table public.nala_response_memory is
  'Tenant-scoped operational response memory. Stores only bounded safe reusable answers from routed external inference; never authoritative knowledge and never personal cross-session memory.';
comment on function public.purge_expired_nala_response_memory() is
  'Called by the existing AI Core maintenance route; removes expired or long-inactive response memory without a new scheduler.';

commit;
