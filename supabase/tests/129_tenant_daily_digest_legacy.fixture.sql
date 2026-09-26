-- Variant: an environment where the first draft of 129 (tenants.daily_digest_*
-- columns) had already been applied. Runs after 129_tenant_daily_digest.seed.sql.
alter table public.tenants
  add column if not exists daily_digest_enabled boolean not null default false,
  add column if not exists daily_digest_timezone text not null default 'Europe/Rome',
  add column if not exists daily_digest_include_empty boolean not null default false,
  add column if not exists daily_digest_prepare_hours integer not null default 24 check (daily_digest_prepare_hours between 1 and 336),
  add column if not exists daily_digest_pickup_hours integer not null default 48 check (daily_digest_pickup_hours between 1 and 336),
  add column if not exists daily_digest_payment_hours integer not null default 48 check (daily_digest_payment_hours between 1 and 336),
  add column if not exists daily_digest_shipping_hours integer not null default 72 check (daily_digest_shipping_hours between 24 and 336);

-- Simulate an accidental public grant to prove 129 closes it.
grant select (daily_digest_enabled, daily_digest_timezone) on table public.tenants to anon;

-- Tenant A enabled and customized; tenant B customized but disabled; C untouched.
update public.tenants set daily_digest_enabled = true, daily_digest_timezone = 'Europe/Paris',
  daily_digest_prepare_hours = 12, daily_digest_shipping_hours = 96
where id = '11111111-1111-4111-8111-111111111111';
update public.tenants set daily_digest_include_empty = true
where id = '22222222-2222-4222-8222-222222222222';
