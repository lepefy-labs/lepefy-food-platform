-- Schema state before 094 with the loyalty and referral columns of 040 and the
-- public column grants of 076: CI replays 094 -> 096 -> 129 -> 130 -> 131 -> 132 -> 133 -> 134.
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
  referral_max_depth integer not null default 2 check (referral_max_depth >= 1 and referral_max_depth <= 5),
  referral_fraud_max_conversions numeric not null default 10,
  referral_fraud_period_days integer not null default 30,
  referral_fraud_action text not null default 'FLAG_FOR_REVIEW' check (referral_fraud_action in ('FLAG_FOR_REVIEW','AUTO_BLOCK','CAP_AT_THRESHOLD')),
  referral_availability_mode text not null default 'ALL_CUSTOMERS' check (referral_availability_mode in ('ALL_CUSTOMERS','SPENDING_THRESHOLD','ADMIN_GRANTED_ONLY')),
  referral_unlock_spending_threshold numeric(10,2),
  ai_image_generation boolean not null default false,
  ai_description_generation boolean not null default false,
  ai_semantic_search boolean not null default false,
  ai_rate_limit_public_per_minute integer not null default 20,
  ai_rate_limit_public_per_day integer not null default 500,
  ai_rate_limit_admin_per_day integer not null default 200,
  chatbox_extra_context text,
  catalogue_search_threshold integer not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on table public.tenants from anon, authenticated;
grant select (id, slug, name, active, ai_chatbox_enabled, loyalty_enabled, purchase_points_rate,
  points_to_currency_rate, referral_signup_bonus_points, referral_max_depth, referral_fraud_max_conversions,
  referral_fraud_period_days, referral_fraud_action, referral_availability_mode, referral_unlock_spending_threshold)
  on table public.tenants to anon, authenticated;
grant select (ai_image_generation, ai_description_generation, ai_semantic_search, ai_rate_limit_public_per_minute,
  ai_rate_limit_public_per_day, catalogue_search_threshold) on table public.tenants to anon, authenticated;
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

-- Referral values per tenant: customized, defaults (null threshold), fractional.
update public.tenants set referral_max_depth = 3, referral_availability_mode = 'SPENDING_THRESHOLD',
  referral_unlock_spending_threshold = 120.50, referral_fraud_action = 'AUTO_BLOCK'
where id = '11111111-1111-4111-8111-111111111111';
update public.tenants set referral_availability_mode = 'ADMIN_GRANTED_ONLY', referral_fraud_max_conversions = 2.5,
  referral_fraud_period_days = 7, referral_unlock_spending_threshold = 0.00
where id = '33333333-3333-4333-8333-333333333333';

-- AI values: A customized with a private context, B defaults, C semantic only.
update public.tenants set ai_description_generation = true, ai_semantic_search = true,
  ai_rate_limit_public_per_minute = 5, chatbox_extra_context = 'Horaires : 9h-19h. Parking gratuit.'
where id = '11111111-1111-4111-8111-111111111111';
update public.tenants set ai_semantic_search = true, ai_rate_limit_admin_per_day = 50
where id = '33333333-3333-4333-8333-333333333333';

-- Rate limiting of 027 (reads the tenants columns, i.e. the 134 mirror).
create table public.ai_usage_log (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id),
  endpoint text not null,
  status text not null,
  created_at timestamptz not null default now()
);
create or replace function public.check_ai_rate_limit(p_tenant_id uuid, p_endpoint text, p_is_public boolean)
returns boolean language plpgsql as $$
declare v_minute_count int; v_day_count int; v_limit_minute int; v_limit_day int;
begin
  select ai_rate_limit_public_per_minute,
    case when p_is_public then ai_rate_limit_public_per_day else ai_rate_limit_admin_per_day end
  into v_limit_minute, v_limit_day from public.tenants where id = p_tenant_id;
  if p_is_public then
    select count(*) into v_minute_count from public.ai_usage_log
    where tenant_id = p_tenant_id and endpoint = p_endpoint and status = 'success' and created_at > now() - interval '1 minute';
    if v_minute_count >= v_limit_minute then return false; end if;
  end if;
  select count(*) into v_day_count from public.ai_usage_log
  where tenant_id = p_tenant_id and endpoint = p_endpoint and status = 'success' and created_at > now() - interval '1 day';
  if v_day_count >= v_limit_day then return false; end if;
  return true;
end $$;
