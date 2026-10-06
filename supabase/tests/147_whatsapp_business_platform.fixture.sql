-- Minimal schema needed by 147 (tenants, customers, admin RBAC catalogue) on a
-- throwaway database. Self-contained: does not replay earlier migrations.
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

create table public.customers (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone text
);

create table public.admin_users (
  id uuid primary key,
  email text not null
);

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text unique not null
);

create table public.admin_permissions (
  key text primary key,
  module text not null,
  label text not null,
  description text,
  risk_level text not null,
  position integer not null default 0
);

create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_key text not null references public.admin_permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

insert into public.tenants (id, slug, name) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B');
insert into public.customers (id, tenant_id, phone) values
  ('cccccccc-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', '+393331112222'),
  ('cccccccc-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', '+393331112222');
insert into public.admin_users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'agent@example.test');
insert into public.admin_roles (code) values ('platform_owner'), ('tenant_admin'), ('tenant_cashier');
