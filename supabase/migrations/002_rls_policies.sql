-- ─── ENABLE RLS ON ALL TABLES ─────────────────────────────────────────────────
alter table tenants       enable row level security;
alter table categories    enable row level security;
alter table products      enable row level security;
alter table customers     enable row level security;
alter table addresses     enable row level security;
alter table orders        enable row level security;
alter table order_items   enable row level security;
alter table shipping_zones  enable row level security;
alter table shipping_rates  enable row level security;

-- ─── TENANTS ──────────────────────────────────────────────────────────────────
-- Public read (needed to resolve tenant config at boot)
create policy "tenants_select_public"
  on tenants for select
  using (active = true);

-- ─── CATEGORIES ───────────────────────────────────────────────────────────────
create policy "categories_select_public"
  on categories for select
  using (true);

-- Service role bypass for admin mutations (handled via service key in API routes)

-- ─── PRODUCTS ─────────────────────────────────────────────────────────────────
create policy "products_select_public"
  on products for select
  using (active = true);

-- ─── CUSTOMERS ────────────────────────────────────────────────────────────────
create policy "customers_select_own"
  on customers for select
  using (id = auth.uid());

create policy "customers_insert_own"
  on customers for insert
  with check (id = auth.uid());

create policy "customers_update_own"
  on customers for update
  using (id = auth.uid());

-- ─── ADDRESSES ────────────────────────────────────────────────────────────────
create policy "addresses_select_own"
  on addresses for select
  using (customer_id = auth.uid());

create policy "addresses_insert_own"
  on addresses for insert
  with check (customer_id = auth.uid());

create policy "addresses_update_own"
  on addresses for update
  using (customer_id = auth.uid());

create policy "addresses_delete_own"
  on addresses for delete
  using (customer_id = auth.uid());

-- ─── ORDERS ───────────────────────────────────────────────────────────────────
-- Authenticated users see their orders
create policy "orders_select_own"
  on orders for select
  using (customer_id = auth.uid());

-- Guest checkout: any authenticated or anon can insert (service role validates in API)
create policy "orders_insert_any"
  on orders for insert
  with check (true);

-- ─── ORDER ITEMS ──────────────────────────────────────────────────────────────
create policy "order_items_select_via_order"
  on order_items for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and o.customer_id = auth.uid()
    )
  );

create policy "order_items_insert_any"
  on order_items for insert
  with check (true);

-- ─── SHIPPING ZONES ───────────────────────────────────────────────────────────
create policy "shipping_zones_select_public"
  on shipping_zones for select
  using (active = true);

-- ─── SHIPPING RATES ───────────────────────────────────────────────────────────
create policy "shipping_rates_select_public"
  on shipping_rates for select
  using (active = true);
