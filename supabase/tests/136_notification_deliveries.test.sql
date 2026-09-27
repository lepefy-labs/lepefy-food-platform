-- 136: uniqueness per tenant, privileges, claim semantics.
do $$
declare
  t1 uuid := '11111111-1111-4111-8111-111111111111';
  t2 uuid := '22222222-2222-4222-8222-222222222222';
  n int;
begin
  -- Same key twice for one tenant is rejected; another tenant may reuse it.
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload)
  values (t1, 'order-confirmed:a', 'order_confirmed', '/webhook/order-confirmed', '{}');
  begin
    insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload)
    values (t1, 'order-confirmed:a', 'order_confirmed', '/webhook/order-confirmed', '{}');
    raise exception 'duplicate key accepted';
  exception when unique_violation then null;
  end;
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload)
  values (t2, 'order-confirmed:a', 'order_confirmed', '/webhook/order-confirmed', '{}');

  -- Webhook path is constrained.
  begin
    insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload)
    values (t1, 'x:1', 'x', 'https://evil.example/hook', '{}');
    raise exception 'arbitrary webhook path accepted';
  exception when check_violation then null;
  end;

  -- Fresh rows are 'processing' with no lock: not claimable (immediate send owns them)...
  select count(*) into n from public.claim_notification_deliveries(10);
  if n <> 0 then raise exception 'fresh processing rows must not be claimed, got %', n; end if;

  -- ...a failed row that is due is claimed once, and its attempt counter moves.
  update public.notification_deliveries set status = 'failed', attempts = 1, next_attempt_at = now() - interval '1 minute'
   where tenant_id = t1 and idempotency_key = 'order-confirmed:a';
  select count(*) into n from public.claim_notification_deliveries(10);
  if n <> 1 then raise exception 'due failed row not claimed, got %', n; end if;
  select attempts into n from public.notification_deliveries where tenant_id = t1 and idempotency_key = 'order-confirmed:a';
  if n <> 2 then raise exception 'attempts not incremented, got %', n; end if;
  select count(*) into n from public.claim_notification_deliveries(10);
  if n <> 0 then raise exception 'locked row claimed twice, got %', n; end if;

  -- An expired lock (crashed send) is recovered.
  update public.notification_deliveries set locked_until = now() - interval '1 second'
   where tenant_id = t1 and idempotency_key = 'order-confirmed:a';
  select count(*) into n from public.claim_notification_deliveries(10);
  if n <> 1 then raise exception 'expired lock not recovered, got %', n; end if;

  -- Exhausted attempts, future retries, cleared payloads and accepted rows are never claimed.
  update public.notification_deliveries set status = 'failed', attempts = 5, max_attempts = 5, next_attempt_at = now() - interval '1 minute'
   where tenant_id = t1 and idempotency_key = 'order-confirmed:a';
  update public.notification_deliveries set status = 'failed', next_attempt_at = now() + interval '1 hour'
   where tenant_id = t2;
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload, status, next_attempt_at)
  values (t1, 'done:1', 'x', '/webhook/send-email', null, 'accepted', now() - interval '1 hour'),
         (t1, 'nopayload:1', 'x', '/webhook/send-email', null, 'failed', now() - interval '1 hour');
  select count(*) into n from public.claim_notification_deliveries(10);
  if n <> 0 then raise exception 'non-claimable rows claimed, got %', n; end if;
end $$;

-- Privileges: service_role only.
do $$
begin
  if has_table_privilege('anon', 'public.notification_deliveries', 'select')
     or has_table_privilege('authenticated', 'public.notification_deliveries', 'select') then
    raise exception 'notification_deliveries readable by anon/authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.notification_deliveries', 'insert') then
    raise exception 'service_role cannot insert';
  end if;
  if has_function_privilege('anon', 'public.claim_notification_deliveries(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_notification_deliveries(integer)', 'execute') then
    raise exception 'claim RPC executable by anon/authenticated';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.notification_deliveries'::regclass) then
    raise exception 'RLS disabled';
  end if;
end $$;

select 'notification deliveries: ok' as result;
