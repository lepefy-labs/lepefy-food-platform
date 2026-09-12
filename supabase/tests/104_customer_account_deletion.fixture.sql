drop schema if exists public cascade;
drop schema if exists auth cascade;
create schema public;
create schema auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
grant usage on schema public to service_role, anon;

create table public.tenants(id uuid primary key);
create table auth.users(id uuid primary key);
create table public.customers(
  id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  email text not null,
  referred_by_id uuid constraint customers_referred_by_id_fkey references public.customers(id)
);
create table public.addresses(id uuid primary key, tenant_id uuid not null, customer_id uuid not null references public.customers(id) on delete cascade);
create table public.orders(id uuid primary key, tenant_id uuid not null, customer_id uuid references public.customers(id) on delete set null);
create table public.checkout_sessions(
  id uuid primary key, tenant_id uuid not null, customer_id uuid references public.customers(id) on delete set null,
  status text not null, order_id uuid references public.orders(id)
);
create table public.carts(id uuid primary key, tenant_id uuid not null, customer_id uuid not null references public.customers(id) on delete cascade);
create table public.referral_codes(id uuid primary key, tenant_id uuid not null, owner_customer_id uuid not null constraint referral_codes_owner_customer_id_fkey references public.customers(id));
create table public.points_ledger(
  id uuid primary key, tenant_id uuid not null,
  customer_id uuid not null constraint points_ledger_customer_id_fkey references public.customers(id),
  reference_customer_id uuid constraint points_ledger_reference_customer_id_fkey references public.customers(id)
);
create table public.referral_fraud_signals(
  id uuid primary key, tenant_id uuid not null,
  customer_id uuid not null constraint referral_fraud_signals_customer_id_fkey references public.customers(id),
  matched_customer_id uuid not null constraint referral_fraud_signals_matched_customer_id_fkey references public.customers(id)
);
create table public.loyalty_manual_purchases(
  id uuid primary key, tenant_id uuid not null,
  customer_id uuid not null constraint loyalty_manual_purchases_customer_id_fkey references public.customers(id)
);
create table public.ambassador_commissions(
  id uuid primary key, tenant_id uuid not null,
  ambassador_customer_id uuid not null constraint ambassador_commissions_ambassador_customer_id_fkey references public.customers(id),
  referred_customer_id uuid not null constraint ambassador_commissions_referred_customer_id_fkey references public.customers(id),
  status text not null,
  constraint uq_ambassador_commission_per_referred unique (tenant_id, referred_customer_id)
);
create table public.user_consents(
  id uuid primary key, tenant_id uuid not null,
  user_id uuid constraint user_consents_user_id_fkey references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id),
  constraint user_consents_anchor_check check (user_id is not null or order_id is not null)
);
create table public.nala_sessions(id uuid primary key, tenant_id uuid not null, customer_id uuid references public.customers(id) on delete set null);
create table public.ai_conversations(id uuid primary key, tenant_id uuid not null, customer_id uuid references public.customers(id) on delete set null);
create table public.guest_checkout_records(id uuid primary key, tenant_id uuid not null, email text not null);

insert into public.tenants values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');
insert into auth.users values
 ('20000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002');
insert into public.customers(id,tenant_id,email) values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','target@example.test'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','other@example.test');
update public.customers set referred_by_id='20000000-0000-0000-0000-000000000001'
where id='20000000-0000-0000-0000-000000000002';

insert into public.addresses values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.carts values ('31000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.orders values ('32000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.checkout_sessions values
 ('33000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','open',null),
 ('33000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','completed','32000000-0000-0000-0000-000000000001'),
 ('33000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','awaiting_verification',null);
insert into public.referral_codes values ('34000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.points_ledger values
 ('35000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null),
 ('35000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
insert into public.referral_fraud_signals values ('36000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into public.loyalty_manual_purchases values ('37000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.ambassador_commissions values ('38000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','PAID');
insert into public.user_consents values
 ('39000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',null),
 ('39000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001');
insert into public.nala_sessions values ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.ai_conversations values ('41000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001');
insert into public.guest_checkout_records values ('42000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','target@example.test');
