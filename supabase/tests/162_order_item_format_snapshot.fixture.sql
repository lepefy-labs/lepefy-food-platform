-- Minimal schema for 162: products with the selling-format columns (018/154)
-- and order_items as inserted by the order creation paths.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.products (
  id uuid primary key, tenant_id uuid not null, name text not null, price numeric(10,2) not null default 5,
  weight_grams int, net_quantity_display text, sale_unit text, net_content_value numeric(10,3),
  net_content_unit text, pack_count integer
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null, tenant_id uuid not null,
  product_id uuid references public.products(id) on delete set null, name text not null,
  price numeric(10,2) not null, quantity int not null, subtotal numeric(10,2) not null,
  storage_type text, picked_at timestamptz
);
grant select, insert, update on public.order_items to service_role;

insert into public.products (id, tenant_id, name, weight_grams, net_quantity_display, sale_unit, net_content_value, net_content_unit, pack_count) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Kaolin', 180, null, 'sachet', 150, 'g', null),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'Bissap', 600, '500 ml', null, null, null, null),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Mitoumba', 900, null, null, null, null, null),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', 'Kaolin', 180, null, 'sachet', 150, 'g', null),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'Malta', 4300, null, 'carton', 33, 'cl', 12);

-- Legacy row written before 162 (no snapshot column yet).
insert into public.order_items (order_id, tenant_id, product_id, name, price, quantity, subtotal)
values ('30000000-0000-4000-8000-000000000000', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Kaolin', 4, 1, 4);
