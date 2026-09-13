drop schema public cascade;
create schema public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
create extension if not exists pgcrypto;

create table public.tenants (
  id uuid primary key,
  name text not null
);
insert into public.tenants (id, name) values
('11111111-1111-4111-8111-111111111111', 'Tenant A'),
('22222222-2222-4222-8222-222222222222', 'Tenant B');
