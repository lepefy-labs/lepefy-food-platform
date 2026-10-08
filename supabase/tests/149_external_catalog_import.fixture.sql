-- Minimal schema needed by 149 (tenants, admin users, categories, products) on a
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

create table public.admin_users (
  id uuid primary key,
  email text not null
);

create table public.categories (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null
);

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  category_id          uuid references public.categories(id) on delete set null,
  name                 text not null,
  slug                 text not null,
  description          text,
  price                numeric(10,2) not null check (price >= 0),
  image_url            text,
  images               jsonb not null default '[]',
  weight_grams         int,
  stock                int not null default 999,
  active               boolean not null default true,
  min_order_quantity   integer not null default 1,
  order_quantity_step  integer not null default 1,
  net_quantity_display text,
  updated_at           timestamptz not null default now(),
  unique (tenant_id, slug)
);

-- Come in Supabase: service_role può leggere e scrivere le tabelle esistenti.
grant select, insert, update, delete on public.tenants, public.admin_users, public.categories, public.products to service_role;

insert into public.tenants (id, slug, name) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B');
insert into public.admin_users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'owner@example.test');
insert into public.categories (id, tenant_id, name) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'Épicerie A'),
  ('aaaaaaaa-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'Épicerie B');
insert into public.products (id, tenant_id, category_id, name, slug, price) values
  ('eeeeeeee-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Arachide existante', 'arachide-ndole', 4.50),
  ('eeeeeeee-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-00000000000b', 'Produit B', 'produit-b', 2.00);
