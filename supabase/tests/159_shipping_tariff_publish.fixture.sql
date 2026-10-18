-- Minimal schema for 124 → 125 → 159: tenants, drafts and packaging profiles
-- as referenced by the shipping tariff migrations, plus the API roles, on a
-- throwaway database (same pattern as the other self-contained fixtures).
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (id uuid primary key, name text not null default 'Tenant');
create table public.shipping_tariff_drafts (id uuid primary key);
create table public.shipping_packaging_profiles (id uuid primary key);

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Pilot'),
  ('10000000-0000-4000-8000-000000000002', 'Other');
