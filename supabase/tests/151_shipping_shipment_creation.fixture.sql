-- Minimal schema needed by 151 (settings layer + orders shipping columns from 111)
-- on a throwaway database. Self-contained: does not replay 096/111.
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
  shipping_provider text
);

create table public.orders (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'preparing',
  fulfillment_type text not null default 'delivery',
  shipping_tracking_mode text check (shipping_tracking_mode in ('managed', 'manual')),
  shipping_provider_key text,
  shipping_provider_reference text
);
create unique index orders_tenant_shipping_reference_idx on public.orders
  (tenant_id, shipping_provider_key, shipping_provider_reference)
  where shipping_provider_reference is not null;

create table public.platform_features (
  key text primary key,
  name text not null,
  description text,
  category text not null,
  active boolean not null default true,
  billable boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_feature_settings (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_key text not null references public.platform_features(key),
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);

insert into public.tenants (id, slug, shipping_provider) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'packlink'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'flat_rate');
insert into public.orders (id, tenant_id, shipping_tracking_mode, shipping_provider_key, shipping_provider_reference) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', null, null, null),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'managed', 'packlink', 'IT2026PRO0000000001'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', null, null, null);
