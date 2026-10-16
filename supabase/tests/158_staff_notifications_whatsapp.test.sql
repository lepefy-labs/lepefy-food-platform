-- 158: WhatsApp channel, dispatcher lookup, events, outbox claim, backfill runs.
-- Chain: 143 fixture → 143 → 136 → 137 → 158 (twice) → this file.
do $$
declare
  t1 constant uuid := '11111111-1111-4111-8111-111111111111';
  t2 constant uuid := '22222222-2222-4222-8222-222222222222';
  owner constant uuid := 'd0000000-0000-4000-8000-000000000001';
  cashier constant uuid := 'd0000000-0000-4000-8000-000000000002';
  wa_only uuid;
  ev uuid;
  ev2 uuid;
  emails text[];
  targets text[];
  claimed int;
begin
  -- Existing preferences untouched: still email only, same count as after 143.
  if (select count(*) from public.tenant_notification_subscriptions) <> 10 then raise exception 'subscriptions changed'; end if;
  if exists (select 1 from public.tenant_notification_subscriptions where channel <> 'email') then raise exception 'unexpected channel'; end if;

  -- WhatsApp-only recipient: no email needed, E.164 enforced, one contact required.
  insert into public.tenant_notification_recipients (tenant_id, email, label, whatsapp_phone)
    values (t1, null, 'Cuisine', '+393331112222') returning id into wa_only;
  begin
    insert into public.tenant_notification_recipients (tenant_id, email) values (t1, null);
    raise exception 'recipient without contact accepted';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_notification_recipients (tenant_id, email, whatsapp_phone) values (t1, 'x@chloe.test', '3331112222');
    raise exception 'non E.164 number accepted';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_notification_recipients (tenant_id, email, whatsapp_phone) values (t1, 'y@chloe.test', '+393331112222');
    raise exception 'duplicate WhatsApp number accepted';
  exception when unique_violation then null; end;
  begin
    update public.tenant_notification_recipients set whatsapp_verified_at = now() where id = owner;
    raise exception 'verification without number accepted';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel) values (t1, owner, 'order_created', 'sms');
    raise exception 'unknown channel accepted';
  exception when check_violation then null; end;

  insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel) values
    (t1, wa_only, 'order_created', 'whatsapp'),
    (t1, wa_only, 'order_created', 'email'),
    (t1, owner, 'order_created', 'email'),
    (t1, owner, 'order_international', 'email');

  -- Email lookup ignores the WhatsApp-only recipient even if subscribed on email.
  select array_agg(email) into emails from public.notification_recipient_emails(t1, 'order_created');
  if emails is distinct from array['owner@chloe.test'] then raise exception 'email lookup: %', emails; end if;

  -- WhatsApp targets require a confirmed number.
  if exists (select 1 from public.notification_recipient_targets(t1, array['order_created'], 'whatsapp'))
    then raise exception 'unverified number targeted'; end if;
  update public.tenant_notification_recipients set whatsapp_verified_at = now() where id = wa_only;
  select array_agg(address) into targets from public.notification_recipient_targets(t1, array['order_created'], 'whatsapp');
  if targets is distinct from array['+393331112222'] then raise exception 'whatsapp targets: %', targets; end if;
  select array_agg(type_key order by type_key) into targets
    from public.notification_recipient_targets(t1, array['order_created', 'order_international'], 'email');
  if targets is distinct from array['order_created', 'order_international'] then raise exception 'email targets: %', targets; end if;
  if exists (select 1 from public.notification_recipient_targets(t2, array['order_created'], 'whatsapp'))
    then raise exception 'tenant isolation broken'; end if;

  -- Inactive recipient and inactive membership stop WhatsApp too.
  update public.tenant_notification_recipients set active = false where id = wa_only;
  if exists (select 1 from public.notification_recipient_targets(t1, array['order_created'], 'whatsapp'))
    then raise exception 'inactive recipient targeted'; end if;
  update public.tenant_notification_recipients set active = true, admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' where id = wa_only;
  if exists (select 1 from public.notification_recipient_targets(t1, array['order_created'], 'whatsapp'))
    then raise exception 'inactive membership targeted'; end if;
  update public.tenant_notification_recipients set admin_user_id = null where id = wa_only;

  -- Events: one row per transition.
  insert into public.tenant_notification_events (tenant_id, event_type, entity_type, entity_id, occurrence_id, priority)
    values (t1, 'order_created', 'order', 'o-1', 'created', 'high') returning id into ev;
  insert into public.tenant_notification_events (tenant_id, event_type, entity_type, entity_id, occurrence_id)
    values (t1, 'order_created', 'order', 'o-1', 'created') on conflict do nothing returning id into ev2;
  if ev2 is not null then raise exception 'duplicate event inserted'; end if;
  begin
    insert into public.tenant_notification_events (tenant_id, event_type, entity_type, entity_id, occurrence_id, priority)
      values (t1, 'order_created', 'order', 'o-2', 'created', 'critical');
    raise exception 'unknown priority accepted';
  exception when check_violation then null; end;

  -- Outbox: per recipient × channel, deduplicated by the 136 key.
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload, channel, event_id, recipient_id, status, attempts, next_attempt_at)
    values (t1, 'notif:' || ev || ':' || wa_only || ':whatsapp', 'order_created', '/whatsapp/send-message', '{"to":"x"}', 'whatsapp', ev, wa_only, 'pending', 0, now() - interval '1 minute');
  begin
    insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, channel)
      values (t1, 'notif:' || ev || ':' || wa_only || ':whatsapp', 'order_created', '/whatsapp/send-message', 'whatsapp');
    raise exception 'duplicate delivery accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path)
      values (t1, 'bad-path', 'x', '/elsewhere/x');
    raise exception 'unknown webhook path accepted';
  exception when check_violation then null; end;
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, status, transport)
    values (t1, 'unknown-status', 'x', '/whatsapp/send-message', 'unknown', 'green_api');

  -- Claim: due WhatsApp row claimed once; an interrupted WhatsApp send is never re-claimed.
  select count(*) into claimed from public.claim_notification_deliveries(10);
  if claimed <> 1 then raise exception 'claim count %', claimed; end if;
  update public.notification_deliveries set locked_until = now() - interval '1 minute' where event_id = ev;
  select count(*) into claimed from public.claim_notification_deliveries(10);
  if claimed <> 0 then raise exception 'stale whatsapp send re-claimed'; end if;
  insert into public.notification_deliveries (tenant_id, idempotency_key, notification_type, webhook_path, payload, status, attempts, locked_until)
    values (t1, 'email-stale', 'x', '/webhook/send-email', '{"a":1}', 'processing', 1, now() - interval '1 minute');
  select count(*) into claimed from public.claim_notification_deliveries(10);
  if claimed <> 1 then raise exception 'stale email send must still be re-claimed (136 behaviour)'; end if;

  -- Deleting the event keeps the delivery history.
  delete from public.tenant_notification_events where id = ev;
  if not exists (select 1 from public.notification_deliveries where recipient_id = wa_only and event_id is null)
    then raise exception 'delivery history lost'; end if;

  -- Backfill runs: idempotent per key, bounded, statuses checked.
  insert into public.notification_backfill_runs (tenant_id, idempotency_key, mode, channels, order_ids, fingerprint, expires_at)
    values (t1, 'run-key-0123456789', 'individual', array['whatsapp'], array[gen_random_uuid()], repeat('a', 64), now() + interval '15 minutes');
  begin
    insert into public.notification_backfill_runs (tenant_id, idempotency_key, mode, channels, order_ids, fingerprint, expires_at)
      values (t1, 'run-key-0123456789', 'individual', array['email'], array[gen_random_uuid()], repeat('b', 64), now());
    raise exception 'duplicate run key accepted';
  exception when unique_violation then null; end;
  begin
    insert into public.notification_backfill_runs (tenant_id, idempotency_key, mode, channels, order_ids, fingerprint, expires_at)
      values (t1, 'run-key-abcdefghijk', 'individual', array['sms'], array[gen_random_uuid()], repeat('c', 64), now());
    raise exception 'unknown backfill channel accepted';
  exception when check_violation then null; end;

  -- One confirmed (executing) run per tenant.
  update public.notification_backfill_runs set status = 'confirmed' where idempotency_key = 'run-key-0123456789';
  insert into public.notification_backfill_runs (tenant_id, idempotency_key, mode, channels, order_ids, fingerprint, expires_at)
    values (t1, 'run-key-second-run-x', 'summary', array['email'], array[gen_random_uuid()], repeat('d', 64), now() + interval '15 minutes');
  begin
    update public.notification_backfill_runs set status = 'confirmed' where idempotency_key = 'run-key-second-run-x';
    raise exception 'two executing runs accepted';
  exception when unique_violation then null; end;

  -- Privileges: nothing for anon/authenticated.
  if has_table_privilege('anon', 'public.tenant_notification_events', 'select')
     or has_table_privilege('authenticated', 'public.notification_backfill_runs', 'select')
     or has_function_privilege('anon', 'public.notification_recipient_targets(uuid, text[], text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_notification_deliveries(integer)', 'execute')
    then raise exception 'public privileges leaked'; end if;
  if not has_function_privilege('service_role', 'public.notification_recipient_targets(uuid, text[], text)', 'execute')
    then raise exception 'service_role cannot resolve targets'; end if;

  raise notice 'Migration 158 — vérifications OK';
end $$;
