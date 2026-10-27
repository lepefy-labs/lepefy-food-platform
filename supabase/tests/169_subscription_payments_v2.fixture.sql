-- 169 runs after the 144 fixture + 144 migration (CI: 144 fixture → 144 →
-- this file → 169 twice → 169 test). Adds what 084 has in production and the
-- 144 fixture leaves out.
alter table public.platform_plans
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.platform_billing_settings (
  id text primary key default 'default' check (id = 'default'),
  bank_iban text,
  bank_beneficiary text,
  bank_bic text,
  support_email text not null default 'support@lepefy.com',
  updated_at timestamptz not null default now()
);
alter table public.platform_billing_settings enable row level security;
grant select, insert, update on public.platform_billing_settings to service_role;
insert into public.platform_billing_settings (id) values ('default') on conflict (id) do nothing;

-- An inactive plan created first must never be the default.
insert into public.platform_plans (id, code, name, monthly_price_cents, active, created_at)
values ('e0000000-0000-4000-8000-000000000000', 'old', 'Old plan', 4900, false, '2020-01-01T00:00:00Z')
on conflict (id) do nothing;

-- A payment recorded with the 144 function, before 169.
select * from public.record_tenant_subscription_payment(
  '22222222-2222-4222-8222-222222222222', 'bank_transfer', 8900, 'EUR', '2025-08-05T12:00:00Z',
  null, 'Virement août', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
