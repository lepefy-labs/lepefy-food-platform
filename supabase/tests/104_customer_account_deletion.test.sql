do $$
declare
  target uuid := '20000000-0000-0000-0000-000000000001';
  tenant_one uuid := '10000000-0000-0000-0000-000000000001';
  tenant_two uuid := '10000000-0000-0000-0000-000000000002';
begin
  if public.delete_customer_account_data(tenant_two, target) then
    raise exception 'wrong-tenant deletion must be rejected';
  end if;
  if not exists (select 1 from public.customers where id=target) then
    raise exception 'wrong-tenant call deleted the customer';
  end if;

  if not public.delete_customer_account_data(tenant_one, target) then
    raise exception 'tenant-scoped deletion did not delete the customer';
  end if;

  if exists (select 1 from public.customers where id=target) then raise exception 'customer survived'; end if;
  if exists (select 1 from public.addresses where customer_id=target) then raise exception 'address survived'; end if;
  if exists (select 1 from public.carts where customer_id=target) then raise exception 'cart survived'; end if;
  if exists (select 1 from public.referral_codes where owner_customer_id=target) then raise exception 'referral code survived'; end if;
  if exists (select 1 from public.points_ledger where customer_id=target) then raise exception 'own points survived'; end if;
  if exists (select 1 from public.user_consents where id='39000000-0000-0000-0000-000000000001') then raise exception 'standalone consent survived'; end if;
  if exists (select 1 from public.nala_sessions where customer_id=target) then raise exception 'Nala session survived'; end if;
  if exists (select 1 from public.ai_conversations where customer_id=target) then raise exception 'AI conversation survived'; end if;

  if not exists (select 1 from public.orders where customer_id is null) then raise exception 'order was not preserved/detached'; end if;
  if (select count(*) from public.checkout_sessions) <> 2 then raise exception 'checkout retention is incorrect'; end if;
  if exists (select 1 from public.checkout_sessions where status='open') then raise exception 'open checkout survived'; end if;
  if exists (select 1 from public.checkout_sessions where customer_id is not null) then raise exception 'retained checkout was not detached'; end if;
  if not exists (select 1 from public.user_consents where id='39000000-0000-0000-0000-000000000002' and user_id is null) then raise exception 'order consent not preserved'; end if;
  if not exists (select 1 from public.loyalty_manual_purchases where customer_id is null) then raise exception 'manual purchase history not preserved'; end if;
  if not exists (select 1 from public.ambassador_commissions where ambassador_customer_id is null) then raise exception 'paid commission history not preserved'; end if;
  if not exists (select 1 from public.referral_fraud_signals where customer_id is null) then raise exception 'fraud signal not preserved'; end if;
  if not exists (select 1 from public.points_ledger where id='35000000-0000-0000-0000-000000000002' and reference_customer_id is null) then raise exception 'other customer ledger history not detached'; end if;
  if not exists (select 1 from public.customers where id='20000000-0000-0000-0000-000000000002' and referred_by_id is null) then raise exception 'referred customer not detached'; end if;
  if not exists (select 1 from public.guest_checkout_records where email='target@example.test') then raise exception 'unrelated same-email guest record was deleted'; end if;
  if not exists (select 1 from auth.users where id=target) then raise exception 'Auth identity was not left for the server-last step'; end if;
  if has_table_privilege('anon', 'public.account_deletion_requests', 'select') then raise exception 'deletion state leaked to anon'; end if;
  if not has_function_privilege('service_role', 'public.delete_customer_account_data(uuid,uuid)', 'execute') then raise exception 'service role cannot execute deletion RPC'; end if;
end $$;
