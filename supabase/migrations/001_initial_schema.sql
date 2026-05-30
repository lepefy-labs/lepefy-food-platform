-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ─── TENANTS ──────────────────────────────────────────────────────────────────
create table tenants (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  name             text not null,
  tagline          text,
  logo_url         text,
  primary_color    text not null default '#1D9E75',
  secondary_color  text not null default '#F2C811',
  accent_light     text not null default '#E1F5EE',
  city             text,
  country          text not null default 'IT',
  currency         text not null default 'EUR',
  locale           text not null default 'fr-FR',
  stripe_account_id text,
  click_collect_enabled boolean not null default true,
  click_collect_address text,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ─── CATEGORIES ───────────────────────────────────────────────────────────────
create table categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  slug        text not null,
  image_url   text,
  position    int not null default 0,
  created_at  timestamptz not null default now(),
  unique(tenant_id, slug)
);

-- ─── PRODUCTS ─────────────────────────────────────────────────────────────────
create table products (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  category_id     uuid references categories(id) on delete set null,
  name            text not null,
  slug            text not null,
  description     text,
  price           numeric(10,2) not null check (price >= 0),
  compare_at_price numeric(10,2),
  image_url       text,
  images          jsonb not null default '[]',
  weight_grams    int,
  stock           int not null default 999,
  active          boolean not null default true,
  featured        boolean not null default false,
  position        int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique(tenant_id, slug)
);

-- ─── CUSTOMERS ────────────────────────────────────────────────────────────────
create table customers (
  id          uuid primary key references auth.users(id) on delete cascade,
  tenant_id   uuid not null references tenants(id) on delete cascade,
  email       text not null,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  unique(tenant_id, email)
);

-- ─── ADDRESSES ────────────────────────────────────────────────────────────────
create table addresses (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references customers(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  full_name    text not null,
  line1        text not null,
  line2        text,
  city         text not null,
  postal_code  text not null,
  country      text not null default 'IT',
  is_default   boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ─── ORDERS ───────────────────────────────────────────────────────────────────
create table orders (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references tenants(id),
  customer_id               uuid references customers(id) on delete set null,
  email                     text not null,
  full_name                 text,
  fulfillment_type          text not null default 'delivery'
                              check (fulfillment_type in ('delivery', 'pickup')),
  shipping_address          jsonb,
  subtotal                  numeric(10,2) not null,
  shipping_cost             numeric(10,2) not null default 0,
  total                     numeric(10,2) not null,
  payment_method            text check (payment_method in ('stripe','satispay','cash')),
  payment_status            text not null default 'pending'
                              check (payment_status in ('pending','paid','failed','refunded')),
  stripe_payment_intent_id  text,
  status                    text not null default 'new'
                              check (status in ('new','preparing','shipped','delivered','cancelled')),
  tracking_code             text,
  tracking_carrier          text default 'poste_italiane',
  shipped_at                timestamptz,
  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- ─── ORDER ITEMS ──────────────────────────────────────────────────────────────
create table order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  tenant_id   uuid not null references tenants(id),
  product_id  uuid references products(id) on delete set null,
  name        text not null,
  price       numeric(10,2) not null,
  quantity    int not null check (quantity > 0),
  subtotal    numeric(10,2) not null
);

-- ─── SHIPPING ZONES ───────────────────────────────────────────────────────────
create table shipping_zones (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  name        text not null,
  countries   text[] not null,
  free_above  numeric(10,2),
  active      boolean not null default true,
  position    int not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_shipping_zones_tenant on shipping_zones(tenant_id);

-- ─── SHIPPING RATES ───────────────────────────────────────────────────────────
create table shipping_rates (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  zone_id       uuid not null references shipping_zones(id) on delete cascade,
  min_weight_g  int not null default 0,
  max_weight_g  int,
  rate          numeric(10,2) not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create index idx_shipping_rates_zone on shipping_rates(zone_id, min_weight_g);

-- ─── UPDATED_AT TRIGGERS ──────────────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_updated_at before update on tenants
  for each row execute function update_updated_at();

create trigger products_updated_at before update on products
  for each row execute function update_updated_at();

create trigger orders_updated_at before update on orders
  for each row execute function update_updated_at();
