-- 144: renewal rule, payment idempotency, suspension, platform actions, grants
-- (run after 144 fixture + 144 applied twice).
do $$
declare
  t1 constant uuid := '11111111-1111-4111-8111-111111111111';
  t2 constant uuid := '22222222-2222-4222-8222-222222222222';
  t3 constant uuid := '33333333-3333-4333-8333-333333333333';
  t4 constant uuid := '44444444-4444-4444-8444-444444444444';
  owner constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  r record;
  failed boolean;
begin
  -- Legacy 'expired' converted, defaults conservative.
  if (select status from public.tenant_subscriptions where tenant_id = t3) <> 'suspended'
    then raise exception 'expired must become suspended'; end if;
  if exists (select 1 from public.tenant_subscriptions where suspension_mode <> 'manual' or grace_days <> 15)
    then raise exception 'defaults must be manual / 15 days'; end if;
  if (select status from public.tenant_subscriptions where tenant_id = t1) <> 'active'
    then raise exception 'active rows untouched'; end if;

  -- Period helpers.
  if public.subscription_month_end('2026-09-15T10:00:00Z') <> '2026-09-30T23:59:59Z'::timestamptz
    then raise exception 'month_end'; end if;
  if public.subscription_next_paid_until('2026-09-30T23:59:59Z', '2026-10-25T09:00:00Z', false) <> '2026-10-31T23:59:59Z'::timestamptz
    then raise exception 'late but active covers the next unpaid month'; end if;
  if public.subscription_next_paid_until('2026-10-31T23:59:59Z', '2026-10-20T09:00:00Z', false) <> '2026-11-30T23:59:59Z'::timestamptz
    then raise exception 'early payment extends from the period end'; end if;
  if public.subscription_next_paid_until('2026-12-31T23:59:59Z', '2026-12-28T09:00:00Z', false) <> '2027-01-31T23:59:59Z'::timestamptz
    then raise exception 'december rolls into january'; end if;
  if public.subscription_next_paid_until('2026-07-31T23:59:59Z', '2026-10-25T09:00:00Z', false) <> '2026-08-31T23:59:59Z'::timestamptz
    then raise exception 'not suspended: arrears first'; end if;
  if public.subscription_next_paid_until('2026-07-31T23:59:59Z', '2026-10-25T09:00:00Z', true) <> '2026-10-31T23:59:59Z'::timestamptz
    then raise exception 'suspended: end of the payment month'; end if;
  if public.subscription_next_paid_until('2026-11-30T23:59:59Z', '2026-10-25T09:00:00Z', true) <> '2026-12-31T23:59:59Z'::timestamptz
    then raise exception 'suspended inside a paid period extends normally'; end if;
  if public.subscription_next_paid_until(null, '2026-10-25T09:00:00Z', false) <> '2026-10-31T23:59:59Z'::timestamptz
    then raise exception 'no paid_until: end of payment month'; end if;

  -- Stripe payment: late but active tenant covers October; retry is a no-op.
  select * into r from public.record_tenant_subscription_payment(t1, 'stripe', 8900, 'EUR', '2025-10-25T09:00:00Z', 'cs_test_1', null, null);
  if not r.out_created or r.out_paid_until <> '2025-10-31T23:59:59Z'::timestamptz or r.out_was_suspended
    then raise exception 'stripe payment result: %', r; end if;
  select * into r from public.record_tenant_subscription_payment(t1, 'stripe', 8900, 'EUR', '2025-10-25T09:00:00Z', 'cs_test_1', null, null);
  if r.out_created or r.out_paid_until <> '2025-10-31T23:59:59Z'::timestamptz
    then raise exception 'stripe retry must not extend twice: %', r; end if;
  if (select count(*) from public.tenant_subscription_payments where tenant_id = t1) <> 1
    then raise exception 'one payment row expected'; end if;
  if (select paid_until from public.tenant_subscriptions where tenant_id = t1) <> '2025-10-31T23:59:59Z'::timestamptz
    or (select subscription_paid_until from public.tenants where id = t1) <> '2025-10-31T23:59:59Z'::timestamptz
    then raise exception 'subscription and legacy mirror must match'; end if;
  if (select count(*) from public.tenant_subscription_audit where tenant_id = t1 and action = 'payment_recorded') <> 1
    then raise exception 'payment must be audited once'; end if;

  -- Automatic policy: overdue beyond grace at payment time = suspended.
  update public.tenant_subscriptions set suspension_mode = 'automatic', grace_days = 15 where tenant_id = t2;
  if not public.tenant_subscription_suspended_at('active', null, 'automatic', '2025-07-31T23:59:59Z', 15, '2025-10-25T09:00:00Z')
    then raise exception 'automatic overdue must be suspended'; end if;
  if public.tenant_subscription_suspended_at('active', null, 'automatic', '2025-07-31T23:59:59Z', 15, '2025-08-10T09:00:00Z')
    then raise exception 'within grace must stay active'; end if;
  if public.tenant_subscription_suspended_at('active', null, 'manual', '2025-07-31T23:59:59Z', 15, '2025-10-25T09:00:00Z')
    then raise exception 'manual mode never auto-suspends'; end if;
  select * into r from public.record_tenant_subscription_payment(t2, 'bank_transfer', 8900, 'EUR', '2025-10-25T09:00:00Z', null, 'Virement', owner);
  if not r.out_was_suspended or r.out_paid_until <> '2025-10-31T23:59:59Z'::timestamptz
    then raise exception 'suspended tenant pays the current month only: %', r; end if;

  -- Legacy-converted suspended tenant is reactivated by a payment.
  select * into r from public.record_tenant_subscription_payment(t3, 'bank_transfer', 8900, 'EUR', now(), null, null, owner);
  if (select status from public.tenant_subscriptions where tenant_id = t3) <> 'active'
    or (select suspended_at from public.tenant_subscriptions where tenant_id = t3) is not null
    then raise exception 'payment must reactivate'; end if;

  -- Guards.
  failed := false; begin perform public.record_tenant_subscription_payment(t1, 'bank_transfer', 8900, 'EUR', now(), null, null, null);
  exception when others then failed := sqlerrm = 'actor_required'; end;
  if not failed then raise exception 'bank transfer needs an actor'; end if;
  failed := false; begin perform public.record_tenant_subscription_payment(t4, 'stripe', 8900, 'EUR', now(), 'cs_x', null, null);
  exception when others then failed := sqlerrm = 'subscription_not_found'; end;
  if not failed then raise exception 'missing subscription must raise'; end if;

  -- Platform actions: reason mandatory, suspend / reactivate, overdue guard.
  failed := false; begin perform public.admin_update_tenant_subscription(t1, 'suspend', owner, ' ');
  exception when others then failed := sqlerrm = 'reason_required'; end;
  if not failed then raise exception 'reason must be mandatory'; end if;
  perform public.admin_update_tenant_subscription(t1, 'suspend', owner, 'Impayé');
  if (select status from public.tenant_subscriptions where tenant_id = t1) <> 'suspended'
    then raise exception 'suspend'; end if;
  perform public.admin_update_tenant_subscription(t1, 'reactivate', owner, 'Régularisé');
  if (select status from public.tenant_subscriptions where tenant_id = t1) <> 'active'
    then raise exception 'reactivate'; end if;
  update public.tenant_subscriptions set paid_until = '2026-01-31T23:59:59Z' where tenant_id = t2;
  perform public.admin_update_tenant_subscription(t2, 'suspend', owner, 'Impayé');
  failed := false; begin perform public.admin_update_tenant_subscription(t2, 'reactivate', owner, 'Essai');
  exception when others then failed := sqlerrm = 'reactivate_still_overdue'; end;
  if not failed then raise exception 'reactivate while auto-overdue must raise'; end if;
  perform public.admin_update_tenant_subscription(t2, 'set_suspension_policy', owner, 'Tolérance', p_mode => 'manual', p_grace_days => 30);
  perform public.admin_update_tenant_subscription(t2, 'reactivate', owner, 'Accord de paiement');
  failed := false; begin perform public.admin_update_tenant_subscription(t1, 'set_payment_link', owner, 'Lien', p_payment_link => 'http://pay.test');
  exception when others then failed := sqlerrm = 'invalid_payment_link'; end;
  if not failed then raise exception 'payment link must be https'; end if;
  perform public.admin_update_tenant_subscription(t1, 'set_paid_until', owner, 'Geste commercial', p_paid_until => '2026-12-31T23:59:59Z');
  if (select subscription_paid_until from public.tenants where id = t1) <> '2026-12-31T23:59:59Z'::timestamptz
    then raise exception 'set_paid_until mirrors legacy'; end if;

  -- Module suspension works without a subscription row; duplicate refused.
  perform public.admin_update_tenant_subscription(t4, 'suspend_module', owner, 'Maintenance', p_module_key => 'events');
  failed := false; begin perform public.admin_update_tenant_subscription(t4, 'suspend_module', owner, 'Encore', p_module_key => 'events');
  exception when others then failed := sqlerrm = 'module_already_suspended'; end;
  if not failed then raise exception 'duplicate module suspension'; end if;
  perform public.admin_update_tenant_subscription(t4, 'reactivate_module', owner, 'Fin maintenance', p_module_key => 'events');
  if exists (select 1 from public.tenant_module_suspensions where tenant_id = t4)
    then raise exception 'module reactivation'; end if;
  if (select count(*) from public.tenant_subscription_audit where tenant_id = t4) <> 2
    then raise exception 'module actions audited'; end if;

  -- Grants: ledger and audit are append-only, functions service_role only.
  if has_table_privilege('service_role', 'public.tenant_subscription_payments', 'DELETE')
    or has_table_privilege('service_role', 'public.tenant_subscription_audit', 'UPDATE')
    or has_table_privilege('service_role', 'public.tenant_subscription_payments', 'INSERT')
    then raise exception 'ledger must be written only through the functions'; end if;
  if has_function_privilege('anon', 'public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.admin_update_tenant_subscription(uuid, text, uuid, text, timestamptz, text, text, integer, text)', 'EXECUTE')
    then raise exception 'function grants'; end if;
end $$;
