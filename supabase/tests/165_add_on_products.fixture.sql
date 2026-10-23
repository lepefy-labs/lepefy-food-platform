-- Minimal schema for 165: tenants, products, roles.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (id uuid primary key, name text not null);
create table public.products (
  id uuid primary key, tenant_id uuid not null references public.tenants(id), name text not null, active boolean not null default true
);
insert into public.tenants values
  ('10000000-0000-4000-8000-000000000001', 'Boutique A'),
  ('10000000-0000-4000-8000-000000000002', 'Boutique B');
insert into public.products values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Mambo', true),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Cube Maggi', true),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Chips', false),
  ('30000000-0000-4000-8000-000000000009', '10000000-0000-4000-8000-000000000002', 'Autre boutique', true);
grant select on public.products, public.tenants to service_role;
