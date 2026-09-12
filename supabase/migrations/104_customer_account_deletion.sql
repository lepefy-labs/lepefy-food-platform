-- 104_customer_account_deletion.sql
-- Production-safe, tenant-scoped customer erasure with transactional data cleanup.
-- This migration is intentionally not applied by the application build.

begin;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  auth_user_id uuid not null,
  status text not null default 'processing'
    check (status in ('processing', 'manual_review', 'completed', 'failed')),
  reason_code text,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint account_deletion_requests_tenant_auth_unique unique (tenant_id, auth_user_id)
);

comment on table public.account_deletion_requests is
  'Minimal service-role-only retry and manual-review state for customer erasure. Stores no email or OTP.';
comment on column public.account_deletion_requests.auth_user_id is
  'Stable pseudonymous subject key retained for idempotent retries after the Auth row is deleted.';

alter table public.account_deletion_requests enable row level security;
grant select, insert, update on public.account_deletion_requests to service_role;

alter table public.customers
  drop constraint if exists customers_referred_by_id_fkey,
  add constraint customers_referred_by_id_fkey
    foreign key (referred_by_id) references public.customers(id) on delete set null;

alter table public.referral_codes
  drop constraint if exists referral_codes_owner_customer_id_fkey,
  add constraint referral_codes_owner_customer_id_fkey
    foreign key (owner_customer_id) references public.customers(id) on delete cascade;

alter table public.points_ledger
  drop constraint if exists points_ledger_customer_id_fkey,
  add constraint points_ledger_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete cascade,
  drop constraint if exists points_ledger_reference_customer_id_fkey,
  add constraint points_ledger_reference_customer_id_fkey
    foreign key (reference_customer_id) references public.customers(id) on delete set null;

alter table public.referral_fraud_signals
  alter column customer_id drop not null,
  alter column matched_customer_id drop not null,
  drop constraint if exists referral_fraud_signals_customer_id_fkey,
  add constraint referral_fraud_signals_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete set null,
  drop constraint if exists referral_fraud_signals_matched_customer_id_fkey,
  add constraint referral_fraud_signals_matched_customer_id_fkey
    foreign key (matched_customer_id) references public.customers(id) on delete set null;

alter table public.loyalty_manual_purchases
  alter column customer_id drop not null,
  drop constraint if exists loyalty_manual_purchases_customer_id_fkey,
  add constraint loyalty_manual_purchases_customer_id_fkey
    foreign key (customer_id) references public.customers(id) on delete set null;

alter table public.ambassador_commissions
  alter column ambassador_customer_id drop not null,
  alter column referred_customer_id drop not null,
  drop constraint if exists ambassador_commissions_ambassador_customer_id_fkey,
  add constraint ambassador_commissions_ambassador_customer_id_fkey
    foreign key (ambassador_customer_id) references public.customers(id) on delete set null,
  drop constraint if exists ambassador_commissions_referred_customer_id_fkey,
  add constraint ambassador_commissions_referred_customer_id_fkey
    foreign key (referred_customer_id) references public.customers(id) on delete set null;

alter table public.user_consents
  drop constraint if exists user_consents_user_id_fkey,
  add constraint user_consents_user_id_fkey
    foreign key (user_id) references public.customers(id) on delete set null;

create or replace function public.delete_customer_account_data(
  p_tenant_id uuid,
  p_customer_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.customers
    where id = p_customer_id and tenant_id = p_tenant_id
  ) then
    return false;
  end if;

  -- Standalone account consents are profile data. Order-linked proof survives.
  delete from public.user_consents
  where tenant_id = p_tenant_id
    and user_id = p_customer_id
    and order_id is null;

  -- Only recoverable open checkout state is account-owned. Completed and
  -- awaiting-verification payment trails remain and are detached by FK.
  delete from public.checkout_sessions
  where tenant_id = p_tenant_id
    and customer_id = p_customer_id
    and status = 'open';

  delete from public.nala_sessions
  where tenant_id = p_tenant_id and customer_id = p_customer_id;

  delete from public.ai_conversations
  where tenant_id = p_tenant_id and customer_id = p_customer_id;

  -- Existing CASCADE/SET NULL constraints now erase account-owned rows and
  -- detach legally or operationally required history in the same transaction.
  delete from public.customers
  where id = p_customer_id and tenant_id = p_tenant_id;

  return found;
end;
$$;

revoke all on function public.delete_customer_account_data(uuid, uuid) from public;
grant execute on function public.delete_customer_account_data(uuid, uuid) to service_role;

comment on function public.delete_customer_account_data(uuid, uuid) is
  'Tenant-scoped transactional customer-data erasure. Auth identity deletion is deliberately performed afterwards by the server service.';

commit;
