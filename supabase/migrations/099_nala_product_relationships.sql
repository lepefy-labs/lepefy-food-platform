-- MIGRATION 099: NALA PRODUCT RELATIONSHIPS V1
-- Directional, tenant-safe merchandising relationships plus action attribution metadata.

create table if not exists public.product_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_product_id uuid not null references public.products(id) on delete cascade,
  target_product_id uuid not null references public.products(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('similar', 'substitute', 'complementary')),
  priority integer not null default 0 check (priority >= 0),
  active boolean not null default true,
  source text not null default 'manual'
    check (source in ('manual', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_product_id <> target_product_id),
  unique (tenant_id, source_product_id, target_product_id, relationship_type)
);

create index if not exists product_relationships_source_type_priority_idx
  on public.product_relationships (
    tenant_id,
    source_product_id,
    relationship_type,
    active,
    priority desc
  );

create or replace function public.validate_product_relationship_tenant()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_tenant uuid;
  target_tenant uuid;
begin
  select tenant_id into source_tenant
  from public.products
  where id = new.source_product_id;

  select tenant_id into target_tenant
  from public.products
  where id = new.target_product_id;

  if source_tenant is null or target_tenant is null then
    raise exception 'relationship product not found' using errcode = '23503';
  end if;

  if source_tenant <> new.tenant_id or target_tenant <> new.tenant_id then
    raise exception 'relationship products must belong to tenant' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists product_relationships_validate_tenant on public.product_relationships;
create trigger product_relationships_validate_tenant
  before insert or update of tenant_id, source_product_id, target_product_id
  on public.product_relationships
  for each row execute function public.validate_product_relationship_tenant();

drop trigger if exists product_relationships_updated_at on public.product_relationships;
create trigger product_relationships_updated_at
  before update on public.product_relationships
  for each row execute function public.update_updated_at();

alter table public.product_relationships enable row level security;
revoke all on table public.product_relationships from public, anon, authenticated;
grant select, insert, update, delete on public.product_relationships to service_role;

comment on table public.product_relationships is
  'Directional tenant-managed similar, substitute and complementary product relationships. Manual relationships take precedence over system relationships and runtime semantic fallback.';
comment on column public.product_relationships.priority is
  'Higher values are selected first within the same relationship source.';
comment on column public.product_relationships.source is
  'Persistent origin. V1 allows only manual and deterministic system relationships; semantic fallback is never persisted.';

alter table public.nala_interactions
  add column if not exists action_product_ids uuid[],
  add column if not exists action_relationship_types text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'nala_interactions_action_relationship_types_check'
  ) then
    alter table public.nala_interactions
      add constraint nala_interactions_action_relationship_types_check
      check (
        action_relationship_types is null
        or action_relationship_types <@ array['direct', 'similar', 'substitute', 'complementary']::text[]
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'nala_interactions_action_metadata_cardinality_check'
  ) then
    alter table public.nala_interactions
      add constraint nala_interactions_action_metadata_cardinality_check
      check (
        (action_product_ids is null and action_relationship_types is null)
        or (
          action_product_ids is not null
          and action_relationship_types is not null
          and cardinality(action_product_ids) = cardinality(action_relationship_types)
        )
      );
  end if;
end
$$;

create index if not exists nala_interactions_action_products_idx
  on public.nala_interactions using gin (action_product_ids);

comment on column public.nala_interactions.action_product_ids is
  'Server-issued Structured Product Action product IDs. Kept distinct from retrieval matched_product_ids.';
comment on column public.nala_interactions.action_relationship_types is
  'Relationship type aligned by array position with action_product_ids for future conversion analytics.';
