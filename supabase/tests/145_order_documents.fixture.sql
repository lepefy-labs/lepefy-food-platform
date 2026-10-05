-- Minimal schema needed by 145 (catalog, settings layer, orders, reviews tokens)
-- on a throwaway database. Self-contained: does not replay 094/096/113.
drop schema public cascade;
create schema public;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (
  id uuid primary key,
  slug text unique not null,
  name text not null
);

create table public.orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'new'
);

create table public.platform_features (
  key text primary key,
  name text not null,
  description text,
  category text not null,
  active boolean not null default true,
  billable boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_feature_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.platform_features(key),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

create table public.review_invites (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unique (id, tenant_id)
);

-- Same inline CHECK as 113 (auto-named), so 145 has to find and replace it.
create table public.review_invite_tokens (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.review_invites(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  purpose text not null check (purpose in ('initial','reminder')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

insert into public.tenants (id, slug, name) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B');
insert into public.orders (id, tenant_id) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222');
insert into public.review_invites (id, tenant_id) values
  ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111');
insert into public.review_invite_tokens (invite_id, tenant_id, token_hash, purpose, expires_at) values
  ('cccccccc-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', repeat('a', 64), 'initial', now() + interval '30 days');
