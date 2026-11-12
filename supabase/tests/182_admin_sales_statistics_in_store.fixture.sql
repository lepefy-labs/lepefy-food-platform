-- Adds /card payments to the 181 fixture (run 181_admin_sales_statistics.fixture.sql first).
create table public.tenant_card_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  amount numeric(10,2) not null,
  currency text not null default 'eur',
  status text not null default 'pending' check (status in ('pending', 'paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

insert into public.tenant_card_payments (tenant_id, amount, status, created_at, paid_at) values
  -- counted: Saturday 10 October, 11:00 and 11:30 Paris (slot 08-12), and Tuesday 6 October 17:00 Paris
  ('11111111-1111-4111-8111-111111111111', 12.50, 'paid', '2026-10-10T09:00:00Z', '2026-10-10T09:01:00Z'),
  ('11111111-1111-4111-8111-111111111111', 7.50, 'paid', '2026-10-10T09:30:00Z', '2026-10-10T09:31:00Z'),
  ('11111111-1111-4111-8111-111111111111', 30.00, 'paid', '2026-10-06T15:00:00Z', '2026-10-06T15:01:00Z'),
  -- never counted: unfinished, other tenant, outside the period
  ('11111111-1111-4111-8111-111111111111', 500.00, 'pending', '2026-10-10T09:00:00Z', null),
  ('22222222-2222-4222-8222-222222222222', 500.00, 'paid', '2026-10-10T09:00:00Z', '2026-10-10T09:01:00Z'),
  ('11111111-1111-4111-8111-111111111111', 500.00, 'paid', '2026-10-31T23:30:00Z', '2026-10-31T23:31:00Z');
