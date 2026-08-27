-- MIGRATION 084: PLATFORM / TENANT BILLING BOUNDARY
-- Additive only. Legacy billing columns on tenants remain in place as compatibility fallback.

create table if not exists public.platform_billing_settings (
  id text primary key default 'default' check (id = 'default'),
  bank_iban text,
  bank_beneficiary text,
  bank_bic text,
  support_email text not null default 'support@lepefy.com',
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  monthly_price_cents integer not null check (monthly_price_cents >= 0),
  currency text not null default 'EUR',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_plan_features (
  plan_id uuid not null references public.platform_plans(id) on delete cascade,
  feature_key text not null check (feature_key in ('shop', 'events', 'digital_card', 'ai')),
  label text not null,
  position integer not null default 0,
  primary key (plan_id, feature_key)
);

create table if not exists public.tenant_subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id uuid not null references public.platform_plans(id),
  status text not null default 'active' check (status in ('active', 'expired')),
  paid_until timestamptz,
  stripe_payment_link text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.platform_billing_settings is
  'Lepefy-owned billing configuration shared across tenants. Never expose as tenant-owned configuration.';
comment on table public.platform_plans is
  'Commercial SaaS plans defined by Lepefy. Tenant UI reads assigned plan; price must not be hardcoded in application UI.';
comment on table public.platform_plan_features is
  'Product entitlements included in each Lepefy SaaS plan.';
comment on table public.tenant_subscriptions is
  'Tenant assignment to a Lepefy plan plus tenant-specific subscription lifecycle and payment link.';

alter table public.platform_billing_settings enable row level security;
alter table public.platform_plans enable row level security;
alter table public.platform_plan_features enable row level security;
alter table public.tenant_subscriptions enable row level security;

grant select, insert, update on public.platform_billing_settings to service_role;
grant select, insert, update on public.platform_plans to service_role;
grant select, insert, update, delete on public.platform_plan_features to service_role;
grant select, insert, update on public.tenant_subscriptions to service_role;

-- Preserve the current Lepefy offer as a real plan rather than a UI constant.
insert into public.platform_plans (code, name, monthly_price_cents, currency, active)
values ('food-platform', 'Lepefy Food Platform', 8900, 'EUR', true)
on conflict (code) do update set
  name = excluded.name,
  monthly_price_cents = excluded.monthly_price_cents,
  currency = excluded.currency,
  active = excluded.active,
  updated_at = now();

insert into public.platform_plan_features (plan_id, feature_key, label, position)
select p.id, f.feature_key, f.label, f.position
from public.platform_plans p
cross join (values
  ('shop', 'Boutique', 10),
  ('events', 'Événementiel', 20),
  ('digital_card', 'Carte digitale', 30),
  ('ai', 'Intelligence IA', 40)
) as f(feature_key, label, position)
where p.code = 'food-platform'
on conflict (plan_id, feature_key) do update set
  label = excluded.label,
  position = excluded.position;

-- Backfill every existing tenant into the current plan while preserving its lifecycle/payment link.
insert into public.tenant_subscriptions (tenant_id, plan_id, status, paid_until, stripe_payment_link)
select
  t.id,
  p.id,
  coalesce(t.subscription_status, 'active'),
  t.subscription_paid_until,
  t.stripe_payment_link
from public.tenants t
cross join public.platform_plans p
where p.code = 'food-platform'
on conflict (tenant_id) do nothing;

-- Lepefy bank coordinates are platform-owned. Preserve one existing configured value if present.
insert into public.platform_billing_settings (id, bank_iban, bank_beneficiary, bank_bic, support_email)
select
  'default',
  t.bank_iban,
  t.bank_beneficiary,
  t.bank_bic,
  'support@lepefy.com'
from public.tenants t
where t.bank_iban is not null
limit 1
on conflict (id) do nothing;

insert into public.platform_billing_settings (id, support_email)
values ('default', 'support@lepefy.com')
on conflict (id) do nothing;
