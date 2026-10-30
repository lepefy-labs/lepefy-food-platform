-- Minimal schema for 175: roles, admin users, RBAC catalogue.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.admin_users (id uuid primary key, email text);
create table public.admin_roles (
  id uuid primary key default gen_random_uuid(), code text unique not null, name text not null default '',
  description text, scope text not null default 'tenant', is_system boolean not null default false
);
insert into public.admin_roles (code, name, scope, is_system) values
  ('platform_owner', 'Platform owner', 'platform', true),
  ('tenant_admin', 'Tenant admin', 'tenant', true),
  ('tenant_cashier', 'Cashier', 'tenant', true);
create table public.admin_permissions (
  key text primary key, module text not null, label text not null, description text not null,
  risk_level text not null default 'standard', position integer not null default 0, active boolean not null default true
);
create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id), permission_key text not null references public.admin_permissions(key),
  primary key (role_id, permission_key)
);
