-- Minimal schema for 181: roles, tenants, catalogue, orders.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (id uuid primary key);
create table public.categories (id uuid primary key, tenant_id uuid not null references public.tenants(id), name text not null);
create table public.products (id uuid primary key, tenant_id uuid not null references public.tenants(id), name text not null, category_id uuid references public.categories(id));
create table public.orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  customer_id uuid,
  email text,
  fulfillment_type text not null,
  shipping_address jsonb,
  total numeric(10,2) not null,
  payment_method text,
  payment_status text not null,
  status text not null,
  is_test boolean not null default false,
  created_at timestamptz not null
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid references public.products(id),
  name text not null,
  quantity integer not null,
  subtotal numeric(10,2) not null
);

insert into public.tenants (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');
insert into public.categories (id, tenant_id, name) values
  ('c1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Farines'),
  ('c2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Épices');
insert into public.products (id, tenant_id, name, category_id) values
  ('a1111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111', 'Farine de manioc', 'c1111111-1111-4111-8111-111111111111'),
  ('a2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'Poivre de Penja', 'c2222222-2222-4222-8222-222222222222');

-- Tenant A. Customer X ordered before the period (returning), customer Y is new, one guest by e-mail.
insert into public.orders (id, tenant_id, customer_id, email, fulfillment_type, shipping_address, total, payment_method, payment_status, status, is_test, created_at) values
  -- before the period
  ('00000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', 'x@example.invalid', 'delivery', '{"country":"IT"}', 20, 'stripe', 'paid', 'delivered', false, '2026-09-20T10:00:00Z'),
  -- counted, in the period
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'b1111111-1111-4111-8111-111111111111', 'x@example.invalid', 'delivery', '{"country":"it"}', 50, 'stripe', 'paid', 'delivered', false, '2026-10-05T22:30:00Z'),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'y@example.invalid', 'delivery', '{"country":"FR"}', 30, 'external_link', 'paid', 'shipped', false, '2026-10-06T08:00:00Z'),
  ('00000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', null, 'Guest@Example.invalid ', 'pickup', null, 10, 'in_store', 'paid', 'ready_for_pickup', false, '2026-10-06T13:00:00Z'),
  -- never counted: test, unpaid, cancelled, other tenant, outside the period
  ('00000000-0000-4000-8000-000000000005', '11111111-1111-4111-8111-111111111111', null, 'z@example.invalid', 'delivery', '{"country":"IT"}', 999, 'stripe', 'paid', 'new', true, '2026-10-06T09:00:00Z'),
  ('00000000-0000-4000-8000-000000000006', '11111111-1111-4111-8111-111111111111', null, 'z@example.invalid', 'delivery', '{"country":"IT"}', 999, 'stripe', 'pending', 'new', false, '2026-10-06T09:00:00Z'),
  ('00000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', null, 'z@example.invalid', 'delivery', '{"country":"IT"}', 999, 'stripe', 'paid', 'cancelled', false, '2026-10-06T09:00:00Z'),
  ('00000000-0000-4000-8000-000000000008', '22222222-2222-4222-8222-222222222222', null, 'z@example.invalid', 'delivery', '{"country":"IT"}', 999, 'stripe', 'paid', 'new', false, '2026-10-06T09:00:00Z'),
  ('00000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', null, 'z@example.invalid', 'delivery', '{"country":"IT"}', 999, 'stripe', 'paid', 'new', false, '2026-10-31T23:00:00Z');

insert into public.order_items (order_id, tenant_id, product_id, name, quantity, subtotal) values
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'Farine (ancien nom)', 4, 40),
  ('00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'a2222222-2222-4222-8222-222222222222', 'Poivre de Penja', 1, 5),
  ('00000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'Farine de manioc', 2, 20),
  ('00000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111', null, 'Article supprimé', 1, 10),
  ('00000000-0000-4000-8000-000000000007', '11111111-1111-4111-8111-111111111111', 'a1111111-1111-4111-8111-111111111111', 'Farine de manioc', 50, 999);
