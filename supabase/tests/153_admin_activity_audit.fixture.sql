-- Minimal schema needed by 153 on a throwaway database. Self-contained: it
-- only declares the columns the triggers, the feed adapters and the tests use.
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
  name text not null,
  storefront_url text,
  shipping_provider text,
  packlink_api_key text,
  stripe_account_id text,
  click_collect_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.admin_users (
  id uuid primary key,
  email text not null,
  role text not null,
  tenant_id uuid references public.tenants(id),
  active boolean not null default true,
  first_name text,
  last_name text,
  nickname text
);

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  scope text not null,
  is_system boolean not null default false,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.admin_permissions (
  key text primary key,
  module text not null,
  label text not null,
  description text,
  risk_level text not null default 'standard',
  position integer not null default 0,
  active boolean not null default true
);
create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_key text not null references public.admin_permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);
create table public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role_id uuid not null references public.admin_roles(id),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table public.admin_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.admin_users(id),
  tenant_id uuid references public.tenants(id),
  action text not null,
  target_type text not null,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text,
  full_name text,
  fulfillment_type text not null default 'delivery',
  shipping_address jsonb,
  subtotal numeric(10,2) not null default 0,
  shipping_cost numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0,
  payment_method text,
  payment_status text not null default 'pending',
  external_payment_type text,
  status text not null default 'new',
  tracking_code text,
  tracking_carrier text,
  notes text,
  is_test boolean not null default false,
  shipping_tracking_mode text,
  shipping_provider_key text,
  shipping_provider_reference text,
  shipping_provider_status text,
  shipping_normalized_status text,
  shipping_sync_error text,
  shipping_creation_status text,
  shipping_creation_attempts integer not null default 0,
  shipping_creation_error text,
  picking_started_at timestamptz,
  order_origin text not null default 'storefront',
  sales_channel text,
  created_by_admin_id uuid,
  payment_confirmation_source text,
  payment_received_at timestamptz,
  payment_reference text,
  payment_confirmed_by uuid,
  payment_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid,
  name text not null,
  name_alt text,
  slug text not null,
  description text,
  price numeric(10,2) not null,
  compare_at_price numeric(10,2),
  image_url text,
  images jsonb not null default '[]'::jsonb,
  weight_grams integer,
  stock integer not null default 0,
  active boolean not null default true,
  featured boolean not null default false,
  storage_type text,
  is_homemade boolean not null default false,
  country_of_origin text,
  net_quantity_display text,
  gluten_free_certified boolean not null default false,
  ingredients_text text,
  allergens_text text,
  usage_instructions text,
  conservation_instructions text,
  conservation_after_opening text,
  min_order_quantity integer not null default 1,
  order_quantity_step integer not null default 1,
  embedding text,
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  source text not null default 'admin',
  is_ambassador boolean not null default false,
  ambassador_iban text,
  updated_at timestamptz not null default now()
);

create table public.tenant_feature_flags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  flag_key text not null,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (tenant_id, flag_key)
);
create table public.platform_features (key text primary key);
create table public.tenant_feature_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.platform_features(key),
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  primary key (tenant_id, feature_key)
);
create table public.tenant_payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  method text not null,
  label text,
  value text,
  extra jsonb,
  sort_order int not null default 0,
  active boolean not null default true
);

-- Fonti storiche lette dal feed (colonne usate dagli adapter).
create table public.business_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor_admin_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.whatsapp_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid,
  event_type text not null,
  actor_type text not null,
  actor_admin_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.assisted_order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  checkout_session_id uuid not null,
  order_id uuid,
  event_type text not null,
  actor_type text not null,
  actor_admin_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.tenant_subscription_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null,
  module_key text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  actor_admin_id uuid,
  created_at timestamptz not null default now()
);
create table public.review_moderation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  review_id uuid not null,
  actor_type text not null,
  actor_user_id uuid,
  action text not null,
  previous_status text,
  next_status text,
  reason_code text,
  reason_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.external_catalog_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid,
  source_id uuid not null,
  product_id uuid,
  action text not null,
  fields jsonb not null default '{}'::jsonb,
  actor_id uuid,
  request_key text,
  created_at timestamptz not null default now()
);
create table public.event_capacity_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  event_id uuid not null,
  previous_capacity integer not null,
  new_capacity integer not null,
  delta integer not null,
  reason text,
  changed_by uuid,
  created_at timestamptz not null default now()
);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  notification_type text not null,
  status text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  payload jsonb,
  recipients text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- Come in produzione: service_role legge e scrive le tabelle esistenti.
grant all on all tables in schema public to service_role;
grant select on public.orders, public.products to authenticated;

insert into public.tenants (id, slug, name, shipping_provider, packlink_api_key) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Boutique A', 'packlink', 'pk-secret-a'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Boutique B', 'flat_rate', null);
insert into public.admin_roles (id, code, name, scope, is_system) values
  ('aaaa0000-0000-4000-8000-000000000001', 'platform_owner', 'Platform owner', 'platform', true),
  ('aaaa0000-0000-4000-8000-000000000002', 'tenant_admin', 'Administrateur', 'tenant', true),
  ('aaaa0000-0000-4000-8000-000000000003', 'tenant_cashier', 'Caisse', 'tenant', true);
insert into public.admin_permissions (key, module, label) values ('orders.view', 'Commandes', 'Voir');
insert into public.admin_users (id, email, role, tenant_id, first_name, last_name) values
  ('a0000000-0000-4000-8000-0000000000aa', 'owner@lepefy.test', 'platform_owner', null, 'Paula', 'Owner'),
  ('a0000000-0000-4000-8000-0000000000a1', 'marie@a.test', 'tenant_admin', '11111111-1111-4111-8111-111111111111', 'Marie', 'Dupont'),
  ('a0000000-0000-4000-8000-0000000000b1', 'bob@b.test', 'tenant_admin', '22222222-2222-4222-8222-222222222222', null, null);
insert into public.orders (id, tenant_id, status) values
  ('0a000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'new'),
  ('0b000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'new');
insert into public.products (id, tenant_id, name, slug, price, stock) values
  ('0c000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Attiéké 1 kg', 'attieke-1kg', 4.90, 20);
insert into public.platform_features (key) values ('order_documents');

-- Storico pre-esistente (deve restare identico dopo la migration).
insert into public.business_audit_events (tenant_id, entity_type, entity_id, event_type, actor_admin_id, metadata) values
  ('11111111-1111-4111-8111-111111111111', 'purchase', gen_random_uuid(), 'purchase.created', 'a0000000-0000-4000-8000-0000000000a1', '{"reference": "AC-0001"}'),
  ('11111111-1111-4111-8111-111111111111', 'payment', gen_random_uuid(), 'payment.verified', 'a0000000-0000-4000-8000-0000000000a1', '{"reference": "PF-0001"}');
insert into public.whatsapp_audit_events (tenant_id, event_type, actor_type, detail) values
  ('11111111-1111-4111-8111-111111111111', 'automation_paused', 'system', '{}');
insert into public.assisted_order_events (tenant_id, checkout_session_id, order_id, event_type, actor_type) values
  ('11111111-1111-4111-8111-111111111111', gen_random_uuid(), '0a000000-0000-4000-8000-000000000001', 'stock_conflict', 'system');
insert into public.notification_deliveries (tenant_id, notification_type, status, attempts, last_error, recipients) values
  ('11111111-1111-4111-8111-111111111111', 'order_confirmed', 'failed', 2, 'HTTP 502', '{client@example.com}'),
  ('11111111-1111-4111-8111-111111111111', 'order_confirmed', 'accepted', 1, null, '{client@example.com}');
insert into public.admin_access_audit (actor_user_id, tenant_id, action, target_type, target_id, before_state, created_at) values
  ('a0000000-0000-4000-8000-0000000000aa', '11111111-1111-4111-8111-111111111111', 'membership.created', 'admin_user',
   'a0000000-0000-4000-8000-0000000000a1', '{"email": "marie@a.test"}', now() - interval '10 days');
insert into public.event_capacity_adjustments (tenant_id, event_id, previous_capacity, new_capacity, delta, reason, changed_by) values
  ('22222222-2222-4222-8222-222222222222', gen_random_uuid(), 100, 120, 20, 'Salle agrandie', 'a0000000-0000-4000-8000-0000000000b1');
