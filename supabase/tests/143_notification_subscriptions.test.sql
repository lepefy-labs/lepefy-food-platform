-- 143: subscriptions backfill, lookup function, team link and grants
-- (run after 143 fixture + 143 applied twice).
do $$
declare
  t1 constant uuid := '11111111-1111-4111-8111-111111111111';
  t2 constant uuid := '22222222-2222-4222-8222-222222222222';
  owner constant uuid := 'd0000000-0000-4000-8000-000000000001';
  cashier constant uuid := 'd0000000-0000-4000-8000-000000000002';
  paused constant uuid := 'd0000000-0000-4000-8000-000000000003';
  emails text[];
begin
  -- Backfill: one row per true legacy flag, legacy prefix stripped, idempotent.
  if (select count(*) from public.tenant_notification_subscriptions where recipient_id = owner) <> 6
    then raise exception 'owner should have 6 backfilled subscriptions'; end if;
  if (select array_agg(type_key order by type_key) from public.tenant_notification_subscriptions where recipient_id = cashier)
     is distinct from array['external_payment_pending']
    then raise exception 'cashier backfill mismatch'; end if;
  if exists (select 1 from public.tenant_notification_subscriptions where type_key like 'notify\_%' or type_key = 'rental_reservations')
    then raise exception 'unexpected type keys after backfill'; end if;
  if (select count(*) from public.tenant_notification_subscriptions) <> 10
    then raise exception 'backfill row count mismatch (expected 10, got %)', (select count(*) from public.tenant_notification_subscriptions); end if;

  -- Lookup: inactive recipients excluded, tenant scoped, ordered by creation.
  select array_agg(email) into emails from public.notification_recipient_emails(t1, 'card_payment');
  if emails is distinct from array['owner@chloe.test'] then raise exception 'card_payment lookup: %', emails; end if;
  select array_agg(email) into emails from public.notification_recipient_emails(t1, 'external_payment_pending');
  if emails is distinct from array['owner@chloe.test', 'cashier@chloe.test'] then raise exception 'external lookup: %', emails; end if;
  select array_agg(email) into emails from public.notification_recipient_emails(t2, 'daily_digest');
  if emails is distinct from array['other@other.test'] then raise exception 'tenant scoping broken: %', emails; end if;
  if exists (select 1 from public.notification_recipient_emails(t1, 'unknown_type'))
    then raise exception 'unknown type must return nothing'; end if;
  if exists (select 1 from public.notification_recipient_emails(t1, 'card_payment', 'email') where email = 'paused@chloe.test')
    then raise exception 'inactive recipient returned'; end if;

  -- Team link: active admin keeps receiving, deactivated admin or inactive
  -- membership stops it.
  update public.tenant_notification_recipients set admin_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id = owner;
  if not exists (select 1 from public.notification_recipient_emails(t1, 'card_payment') where email = 'owner@chloe.test')
    then raise exception 'linked active admin must receive'; end if;
  update public.tenant_notification_recipients set admin_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = owner;
  if exists (select 1 from public.notification_recipient_emails(t1, 'card_payment'))
    then raise exception 'deactivated admin must not receive'; end if;
  update public.tenant_notification_recipients set admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' where id = owner;
  if exists (select 1 from public.notification_recipient_emails(t1, 'card_payment'))
    then raise exception 'admin with inactive membership must not receive'; end if;
  begin
    update public.tenant_notification_recipients set admin_user_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' where id = cashier;
    raise exception 'constraint_missing';
  exception when unique_violation then null; end;
  update public.tenant_notification_recipients set admin_user_id = null where id = owner;

  -- Constraints: tenant-consistent FK, key format, channel, PK, cascade.
  begin
    insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key) values (t2, owner, 'card_payment');
    raise exception 'constraint_missing';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key) values (t1, paused, 'Bad-Key');
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel) values (t1, paused, 'daily_digest', 'sms');
    raise exception 'constraint_missing';
  exception when check_violation then null; end;
  begin
    insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key) values (t1, owner, 'card_payment');
    raise exception 'constraint_missing';
  exception when unique_violation then null; end;
  -- A type unknown to the database (added in code later) needs no migration.
  insert into public.tenant_notification_subscriptions (tenant_id, recipient_id, type_key) values (t1, cashier, 'future_type');
  delete from public.tenant_notification_recipients where id = cashier;
  if exists (select 1 from public.tenant_notification_subscriptions where recipient_id = cashier)
    then raise exception 'subscriptions must cascade with the recipient'; end if;

  -- Grants: browser roles see nothing.
  if has_table_privilege('anon', 'public.tenant_notification_subscriptions', 'select')
     or has_table_privilege('authenticated', 'public.tenant_notification_subscriptions', 'select')
     or has_table_privilege('authenticated', 'public.tenant_notification_subscriptions', 'insert')
    then raise exception 'browser roles must not access subscriptions'; end if;
  if has_function_privilege('anon', 'public.notification_recipient_emails(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.notification_recipient_emails(uuid,text,text)', 'execute')
    then raise exception 'browser roles must not call the lookup'; end if;
  if not has_function_privilege('service_role', 'public.notification_recipient_emails(uuid,text,text)', 'execute')
    then raise exception 'service_role must call the lookup'; end if;
end $$;

select 'notification subscriptions: ok' as result;
