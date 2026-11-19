-- Runs after 153 fixture + migrations 153..157: adds what 187 (and 162) read.
alter table public.products
  add column if not exists position integer not null default 0,
  add column if not exists created_at timestamptz not null default now(),
  alter column id set default gen_random_uuid();
alter table public.products add constraint products_tenant_slug_key unique (tenant_id, slug);

create table if not exists public.categories (
  id uuid primary key, tenant_id uuid not null, name text not null, catalog_scope text not null default 'shop'
);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null, tenant_id uuid not null,
  product_id uuid references public.products(id) on delete set null, name text not null,
  price numeric(10,2) not null, quantity int not null, subtotal numeric(10,2) not null
);
grant all on all tables in schema public to service_role;

insert into public.categories (id, tenant_id, name) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Épicerie');

insert into public.products (id, tenant_id, category_id, name, slug, price, stock, storage_type, weight_grams, min_order_quantity, sale_unit, net_quantity_display) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'Piment', 'piment', 2.90, 5, 'dry', 100, 1, null, null),
  ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'Ndole', 'ndole', 3.50, 7, 'dry', 500, 3, 'paquet', '500 g'),
  ('b0000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null,
   'Autre boutique', 'autre', 4.00, 9, 'dry', 300, 1, null, null);
