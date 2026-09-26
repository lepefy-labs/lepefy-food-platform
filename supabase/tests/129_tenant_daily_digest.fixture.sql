-- Schema state just before 094, so CI can replay the real 094 -> 096 -> 129
-- chain (compatibility with previous migrations) on a throwaway database.
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
  packlink_api_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select (id, slug, name, active, ai_chatbox_enabled) on table public.tenants to anon, authenticated;
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
  notify_card_payment boolean not null default true,
  active boolean not null default true,
  unique (tenant_id, email)
);
alter table public.tenant_notification_recipients enable row level security;
revoke all on table public.tenant_notification_recipients from anon, authenticated;
grant select, insert, update, delete on table public.tenant_notification_recipients to service_role;

insert into public.tenants (id, slug, name, active, ai_chatbox_enabled, packlink_api_key) values
  ('11111111-1111-4111-8111-111111111111', 'tenant-a', 'Tenant A', true, true, 'secret-a'),
  ('22222222-2222-4222-8222-222222222222', 'tenant-b', 'Tenant B', true, false, null),
  ('33333333-3333-4333-8333-333333333333', 'tenant-c', 'Tenant C (inactive)', false, true, null);

insert into public.platform_plans (code, name) values ('food-platform', 'Food Platform');
insert into public.platform_plan_features (plan_id, feature_key, label, position)
select id, feature_key, initcap(feature_key), position
from public.platform_plans, (values ('shop', 10), ('ai', 40)) as f(feature_key, position);

insert into public.tenant_notification_recipients (tenant_id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@tenant-a.example'),
  ('22222222-2222-4222-8222-222222222222', 'owner@tenant-b.example');
