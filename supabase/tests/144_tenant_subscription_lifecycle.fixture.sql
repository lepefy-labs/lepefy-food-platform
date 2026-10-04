-- Minimal schema before 144 on a throwaway database (084 shape of
-- tenant_subscriptions, legacy tenants billing columns).
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
  subscription_status text,
  subscription_paid_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.admin_users (
  id uuid primary key,
  email text not null
);

create table public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_cents integer not null
);

create table public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.platform_plans(id),
  status text not null default 'active' check (status in ('active', 'expired')),
  paid_until timestamptz,
  stripe_payment_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_subscriptions enable row level security;
grant select, insert, update on public.tenant_subscriptions to service_role;

insert into public.tenants (id, slug, name, subscription_status, subscription_paid_until) values
  ('11111111-1111-4111-8111-111111111111', 'chloefood', 'Chloe Food', 'active', '2025-09-30T23:59:59Z'),
  ('22222222-2222-4222-8222-222222222222', 'late', 'Late Shop', 'active', '2025-07-31T23:59:59Z'),
  ('33333333-3333-4333-8333-333333333333', 'legacy', 'Legacy Expired', 'expired', '2025-05-31T23:59:59Z'),
  ('44444444-4444-4444-8444-444444444444', 'nosub', 'No Subscription', 'active', null);

insert into public.admin_users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner@lepefy.test');

insert into public.platform_plans (id, code, name, monthly_price_cents)
values ('e0000000-0000-4000-8000-000000000001', 'food', 'Lepefy Food Platform', 8900);

insert into public.tenant_subscriptions (tenant_id, plan_id, status, paid_until) values
  ('11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000001', 'active', '2025-09-30T23:59:59Z'),
  ('22222222-2222-4222-8222-222222222222', 'e0000000-0000-4000-8000-000000000001', 'active', '2025-07-31T23:59:59Z'),
  ('33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-000000000001', 'expired', '2025-05-31T23:59:59Z');
