-- MIGRATION 121: PURCHASE QUANTITY RULES
-- Tenant-configurable minimum + step purchase-quantity rules:
--   - per product   (products.min_order_quantity / order_quantity_step)
--   - per combinable group of products (purchase_quantity_groups), e.g.
--     "Boissons": minimum 12, step 6 — any mix of member products counts
--     toward the group total.
-- A quantity q is valid when: q >= minimum AND (q - minimum) % step == 0.
-- Purely additive: existing products default to minimum=1/step=1, i.e. no
-- behavior change until a tenant explicitly configures different values.

alter table public.products
  add column min_order_quantity  integer not null default 1,
  add column order_quantity_step integer not null default 1;

alter table public.products
  add constraint products_min_order_quantity_positive  check (min_order_quantity >= 1),
  add constraint products_order_quantity_step_positive check (order_quantity_step >= 1);

-- ─── PURCHASE QUANTITY GROUPS ───────────────────────────────────────────────
-- Membership is explicit (not derived from `categories`) so that moving a
-- product between merchandising categories never silently changes a
-- commercial rule.
create table public.purchase_quantity_groups (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  min_quantity  integer not null check (min_quantity >= 1),
  quantity_step integer not null check (quantity_step >= 1),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index purchase_quantity_groups_tenant_idx
  on public.purchase_quantity_groups (tenant_id)
  where active = true;

create table public.purchase_quantity_group_products (
  group_id   uuid not null references public.purchase_quantity_groups(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, product_id)
);

create index purchase_quantity_group_products_product_idx
  on public.purchase_quantity_group_products (product_id);

-- A product belonging to two *active* groups at once would make the group
-- rule ambiguous for the customer. A partial unique index can't express
-- "active" across a join, so this is enforced application-side (admin group
-- membership API rejects assigning a product already in another active
-- group) rather than in SQL — cf. design doc §22.

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.purchase_quantity_groups enable row level security;
alter table public.purchase_quantity_group_products enable row level security;

-- Public read, same principle as `categories`/`products`: the storefront
-- needs to resolve a product's group and thresholds to show cart progress.
-- Only active groups (and their membership) are exposed.
create policy "purchase_quantity_groups_select_public"
  on public.purchase_quantity_groups for select
  using (active = true);

create policy "purchase_quantity_group_products_select_public"
  on public.purchase_quantity_group_products for select
  using (
    exists (
      select 1 from public.purchase_quantity_groups g
      where g.id = purchase_quantity_group_products.group_id
        and g.active = true
    )
  );

grant select on public.purchase_quantity_groups to anon, authenticated;
grant select on public.purchase_quantity_group_products to anon, authenticated;
grant select, insert, update, delete on public.purchase_quantity_groups to service_role;
grant select, insert, update, delete on public.purchase_quantity_group_products to service_role;
