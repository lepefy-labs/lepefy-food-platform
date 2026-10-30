-- Minimal schema for 174: tenants, feature catalogue, roles and permissions.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (id uuid primary key, name text not null);
insert into public.tenants values
  ('10000000-0000-4000-8000-000000000001', 'Boutique A'),
  ('10000000-0000-4000-8000-000000000002', 'Boutique B');

create table public.platform_features (
  key text primary key, name text not null, description text, category text not null,
  active boolean not null default true, billable boolean not null default false,
  position integer not null default 0, updated_at timestamptz not null default now()
);
create table public.platform_plans (id uuid primary key default gen_random_uuid(), code text unique not null);
create table public.platform_plan_features (
  plan_id uuid not null references public.platform_plans(id), feature_key text not null references public.platform_features(key),
  label text, position integer, primary key (plan_id, feature_key)
);
insert into public.platform_plans (code) values ('food-platform');

create table public.admin_roles (id uuid primary key default gen_random_uuid(), code text unique not null);
insert into public.admin_roles (code) values ('platform_owner'), ('tenant_admin'), ('tenant_cashier');
create table public.admin_permissions (
  key text primary key, module text not null, label text not null, description text not null,
  risk_level text not null default 'standard', position integer not null default 0, active boolean not null default true
);
create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id), permission_key text not null references public.admin_permissions(key),
  primary key (role_id, permission_key)
);
