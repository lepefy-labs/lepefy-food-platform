drop schema public cascade;
create schema public;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
create table public.tenants (
  id uuid primary key,
  name text not null,
  logo_url text null,
  packlink_api_key text null
);
insert into public.tenants (id, name, logo_url, packlink_api_key)
values ('11111111-1111-4111-8111-111111111111', 'Existing tenant', 'https://cdn.example.com/logo.png', 'server-secret');
revoke all on table public.tenants from anon, authenticated;
grant select (id, name, logo_url) on table public.tenants to anon, authenticated;
