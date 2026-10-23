-- Minimal schema for 167: tenants, admin users and the RBAC catalogue.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (
  id uuid primary key, slug text unique not null, name text not null,
  active boolean not null default true, is_test boolean not null default false
);
create table public.admin_users (id uuid primary key, email text not null);
create table public.admin_roles (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null, description text,
  scope text not null, is_system boolean not null default false, active boolean not null default true
);
create table public.admin_permissions (key text primary key);
create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_key text not null references public.admin_permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

insert into public.admin_permissions (key) values
  ('orders.view'), ('orders.manage'), ('catalog.view'), ('catalog.manage'), ('customers.view'), ('campaigns.view'),
  ('reviews.view'), ('shipping.view'), ('events.view'), ('events.manage'), ('event_reservations.view'), ('event_payments.view'),
  ('event_payments.refund'), ('suppliers.view'), ('purchases.view'), ('inventory.view'), ('treasury.view'), ('ai_usage.view'),
  ('audit.view'), ('tenant_settings.view'), ('platform.access.manage');

insert into public.tenants (id, slug, name, is_test) values
  ('10000000-0000-4000-8000-000000000001', 'chloefood', 'Boutique réelle', false),
  ('10000000-0000-4000-8000-000000000002', 'lepefy-demo', 'Démo', true);
insert into public.admin_users (id, email) values ('20000000-0000-4000-8000-000000000001', 'visiteur@demo.invalid');
