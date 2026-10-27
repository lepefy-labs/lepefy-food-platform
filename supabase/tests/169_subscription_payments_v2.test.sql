-- 169: PayPal and references, retry-safe records, Stripe event id, legacy
-- mirror, a subscription row for every tenant, grants
-- (run after 144 fixture + 144 + 169 fixture + 169 applied twice).
do $$
declare
  t1 constant uuid := '11111111-1111-4111-8111-111111111111';
  t2 constant uuid := '22222222-2222-4222-8222-222222222222';
  t4 constant uuid := '44444444-4444-4444-8444-444444444444';
  t5 constant uuid := '55555555-5555-4555-8555-555555555555';
  owner constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  food constant uuid := 'e0000000-0000-4000-8000-000000000001';
  r record;
  r2 record;
  failed boolean;
  v_before timestamptz;
begin
  -- Existing data untouched: the 144-era payment is still there, unchanged.
  if (select count(*) from public.tenant_subscription_payments where tenant_id = t2) <> 1
    then raise exception 'existing payment kept'; end if;
  if exists (select 1 from public.tenant_subscription_payments where external_reference is not null or request_key is not null)
    then raise exception 'no backfill of references'; end if;

  -- Backfill: the tenant without a row got one, default active plan, no due date, manual.
  select * into r from public.tenant_subscriptions where tenant_id = t4;
  if not found then raise exception 'backfill must create the missing row'; end if;
  if r.plan_id <> food or r.paid_until is not null or r.status <> 'active' or r.suspension_mode <> 'manual'
    then raise exception 'backfilled row must be food / no due date / active / manual'; end if;
  if (select count(*) from public.tenant_subscriptions) <> 4 then raise exception 'one row per tenant'; end if;

  -- Trigger: a new tenant gets its row.
  insert into public.tenants (id, slug, name) values (t5, 'newshop', 'New Shop');
  if not exists (select 1 from public.tenant_subscriptions where tenant_id = t5 and plan_id = food and paid_until is null)
    then raise exception 'trigger must create the subscription row'; end if;

  -- PayPal needs an actor and a reference.
  failed := false;
  begin perform public.record_tenant_subscription_payment(t1, 'paypal', 8900, 'EUR', '2025-10-05T12:00:00Z', null, null, owner);
  exception when others then failed := sqlerrm = 'reference_required'; end;
  if not failed then raise exception 'paypal without reference must fail'; end if;
  failed := false;
  begin perform public.record_tenant_subscription_payment(t1, 'paypal', 8900, 'EUR', '2025-10-05T12:00:00Z', null, null, null, '7XK21ABC');
  exception when others then failed := sqlerrm = 'actor_required'; end;
  if not failed then raise exception 'paypal without actor must fail'; end if;

  -- PayPal recorded once with the 144 renewal rule (chloefood paid until 2025-09-30).
  select * into r from public.record_tenant_subscription_payment(t1, 'paypal', 8900, 'EUR', '2025-10-05T12:00:00Z',
    null, 'PayPal octobre', owner, '7XK21ABC', 'req-0001-paypal');
  if not r.out_created or r.out_paid_until <> '2025-10-31T23:59:59Z'::timestamptz then raise exception 'paypal renewal'; end if;
  if (select source from public.tenant_subscription_payments where id = r.out_payment_id) <> 'paypal' then raise exception 'source paypal'; end if;
  if (select external_reference from public.tenant_subscription_payments where id = r.out_payment_id) <> '7XK21ABC' then raise exception 'reference kept'; end if;

  -- Same request key (double click, HTTP retry): same payment, no second month.
  select * into r2 from public.record_tenant_subscription_payment(t1, 'paypal', 8900, 'EUR', '2025-10-05T12:00:00Z',
    null, 'PayPal octobre', owner, '7XK21ABC', 'req-0001-paypal');
  if r2.out_created or r2.out_payment_id <> r.out_payment_id then raise exception 'request key must return the same payment'; end if;
  if (select paid_until from public.tenant_subscriptions where tenant_id = t1) <> '2025-10-31T23:59:59Z'::timestamptz
    then raise exception 'retry must not extend'; end if;

  -- Same reference with a new form (another key), any case/spaces: refused.
  failed := false;
  begin perform public.record_tenant_subscription_payment(t1, 'paypal', 8900, 'EUR', '2025-10-06T12:00:00Z',
    null, null, owner, '  7xk21abc ', 'req-0002-paypal');
  exception when others then failed := sqlerrm = 'duplicate_external_reference'; end;
  if not failed then raise exception 'duplicate reference must fail'; end if;

  -- Same reference on another source or another tenant is a different payment.
  select * into r from public.record_tenant_subscription_payment(t1, 'bank_transfer', 8900, 'EUR', '2025-10-20T12:00:00Z',
    null, null, owner, '7XK21ABC', 'req-0003-transfer');
  if not r.out_created or r.out_paid_until <> '2025-11-30T23:59:59Z'::timestamptz then raise exception 'transfer with same text on another source'; end if;
  select * into r from public.record_tenant_subscription_payment(t4, 'paypal', 8900, 'EUR', '2025-10-20T12:00:00Z',
    null, null, owner, '7XK21ABC', 'req-0004-other');
  if not r.out_created then raise exception 'tenants are independent'; end if;

  -- Bank transfer without reference stays possible (144 behaviour).
  select * into r from public.record_tenant_subscription_payment(t2, 'bank_transfer', 8900, 'EUR', '2025-10-21T12:00:00Z', null, null, owner);
  if not r.out_created then raise exception 'transfer without reference'; end if;

  -- Stripe: event id stored, session still the dedup key.
  select * into r from public.record_tenant_subscription_payment(t5, 'stripe', 8900, 'EUR', '2025-10-22T12:00:00Z',
    'cs_live_169', null, null, null, null, 'evt_169');
  if (select stripe_event_id from public.tenant_subscription_payments where id = r.out_payment_id) <> 'evt_169' then raise exception 'event id'; end if;
  select * into r2 from public.record_tenant_subscription_payment(t5, 'stripe', 8900, 'EUR', '2025-10-23T12:00:00Z',
    'cs_live_169', null, null, null, null, 'evt_170');
  if r2.out_created or r2.out_payment_id <> r.out_payment_id then raise exception 'stripe retry by another event is a no-op'; end if;

  -- Invalid inputs.
  failed := false;
  begin perform public.record_tenant_subscription_payment(t1, 'cash', 8900, 'EUR', '2025-10-05T12:00:00Z', null, null, owner);
  exception when others then failed := sqlerrm = 'invalid_source'; end;
  if not failed then raise exception 'unknown source must fail'; end if;
  failed := false;
  begin perform public.record_tenant_subscription_payment(t1, 'paypal', 8900, 'EUR', '2025-10-05T12:00:00Z', null, null, owner, 'ab');
  exception when others then failed := sqlerrm = 'invalid_reference'; end;
  if not failed then raise exception 'too short reference must fail'; end if;

  -- Legacy mirror on suspend / reactivate.
  perform public.admin_update_tenant_subscription(t1, 'suspend', owner, 'Test suspension');
  if (select subscription_status from public.tenants where id = t1) <> 'expired' then raise exception 'suspend mirrors legacy'; end if;
  perform public.admin_update_tenant_subscription(t1, 'reactivate', owner, 'Test reactivation');
  if (select subscription_status from public.tenants where id = t1) <> 'active' then raise exception 'reactivate mirrors legacy'; end if;
  if (select count(*) from public.tenant_subscription_audit where tenant_id = t1 and action in ('suspend', 'reactivate')) < 2
    then raise exception 'actions still audited'; end if;

  -- PayPal link of Lepefy.
  update public.platform_billing_settings set paypal_url = 'https://paypal.me/lepefy' where id = 'default';
  failed := false;
  begin update public.platform_billing_settings set paypal_url = 'http://paypal.me/x' where id = 'default';
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'paypal_url must be https'; end if;

  -- Grants: the service role cannot write the ledger directly, anon cannot call the RPC.
  if has_table_privilege('service_role', 'public.tenant_subscription_payments', 'insert')
    then raise exception 'ledger stays RPC-only'; end if;
  if has_function_privilege('anon', 'public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid, text, text, text)', 'execute')
    then raise exception 'anon must not execute the RPC'; end if;
  if not has_function_privilege('service_role', 'public.record_tenant_subscription_payment(uuid, text, integer, text, timestamptz, text, text, uuid, text, text, text)', 'execute')
    then raise exception 'service role executes the RPC'; end if;
  if exists (select 1 from pg_proc where proname = 'record_tenant_subscription_payment' and pronargs = 8)
    then raise exception 'old 8-argument signature must be gone'; end if;
end $$;
