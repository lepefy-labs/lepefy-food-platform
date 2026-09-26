-- Schema state before 094 with the loyalty columns of 040 and the public
-- column grants of 076, so CI replays 094 -> 096 -> 129 -> 130 as production will.
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
  active boolean not null default true,
  ai_chatbox_enabled boolean not null default false,
  loyalty_enabled boolean not null default false,
  purchase_points_rate numeric(10,4) not null default 1.0,
  points_to_currency_rate numeric(10,4) not null default 0.01,
  referral_signup_bonus_points integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on table public.tenants from anon, authenticated;
grant select (id, slug, name, active, ai_chatbox_enabled, loyalty_enabled, purchase_points_rate,
  points_to_currency_rate, referral_signup_bonus_points) on table public.tenants to anon, authenticated;
grant select, insert, update, delete on table public.tenants to service_role;

create table public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);
create table public.platform_plan_features (
  plan_id uuid not null references public.platform_plans(id) on delete cascade,
  feature_key text not null check (feature_key in ('shop', 'events', 'digital_card', 'ai')),
  label text not null,
  position integer not null default 0,
  primary key (plan_id, feature_key)
);
create table public.tenant_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  active boolean not null default true,
  unique (tenant_id, email)
);

insert into public.tenants (id, slug, name, active, ai_chatbox_enabled, loyalty_enabled, purchase_points_rate, points_to_currency_rate, referral_signup_bonus_points) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A', true, true, true, 1.5, 0.02, 50),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B', true, false, false, 1.0, 0.01, 0),
  ('33333333-3333-4333-8333-333333333333', 'tenant-c', 'Tenant C (inactive)', false, true, true, 2.2575, 0.0525, 0);

insert into public.platform_plans (code, name) values ('food-platform', 'Food Platform');
