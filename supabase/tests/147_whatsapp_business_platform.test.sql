-- Runs after 147 has been applied twice (idempotency) on the 147 fixture.
begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  customer_a constant uuid := 'cccccccc-0000-4000-8000-00000000000a';
  customer_b constant uuid := 'cccccccc-0000-4000-8000-00000000000b';
  agent constant uuid := 'dddddddd-0000-4000-8000-000000000001';
  channel_a uuid;
  channel_b uuid;
  r record;
  first_message uuid;
  first_conversation uuid;
  outbound uuid;
  t text;
begin
  -- 1. Privileges: browser roles have nothing, service role has exactly what the app needs.
  foreach t in array array['tenant_whatsapp_channels', 'whatsapp_conversations', 'whatsapp_messages',
    'whatsapp_automation_rules', 'whatsapp_handoffs', 'whatsapp_audit_events'] loop
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
       or has_table_privilege('anon', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update')
      then raise exception '% must not be accessible to browser roles', t; end if;
    if not has_table_privilege('service_role', 'public.' || t, 'select') or not has_table_privilege('service_role', 'public.' || t, 'insert')
      then raise exception 'service_role must read and insert %', t; end if;
    if not (select relrowsecurity and relforcerowsecurity from pg_class where oid = ('public.' || t)::regclass)
      then raise exception 'RLS must be enabled and forced on %', t; end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = t)
      then raise exception '% must have no policy (service role only)', t; end if;
  end loop;
  if has_table_privilege('service_role', 'public.tenant_whatsapp_channels', 'delete')
    then raise exception 'channels are disabled, never deleted'; end if;
  if has_table_privilege('service_role', 'public.whatsapp_audit_events', 'update')
     or has_table_privilege('service_role', 'public.whatsapp_audit_events', 'delete')
    then raise exception 'audit events are append-only'; end if;
  if has_function_privilege('anon', 'public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_whatsapp_inbound_messages(integer, uuid[], integer, integer)', 'execute')
     or has_function_privilege('anon', 'public.apply_whatsapp_message_status(uuid, text, text, timestamptz, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.purge_expired_whatsapp_data(integer, integer)', 'execute')
    then raise exception 'WhatsApp RPCs must not be executable by browser roles'; end if;

  -- 2. Channels: (provider, phone_number_id) unique across tenants; no plaintext token column.
  insert into public.tenant_whatsapp_channels (tenant_id, waba_id, phone_number_id, status)
  values (a, '100000000000001', '200000000000001', 'active') returning id into channel_a;
  insert into public.tenant_whatsapp_channels (tenant_id, waba_id, phone_number_id, status, access_token_env)
  values (b, '100000000000002', '200000000000002', 'pending', 'META_WHATSAPP_TENANT_B_TOKEN') returning id into channel_b;
  begin
    insert into public.tenant_whatsapp_channels (tenant_id, waba_id, phone_number_id) values (b, '100000000000003', '200000000000001');
    raise exception 'the same phone_number_id was mapped to a second tenant';
  exception when unique_violation then null; end;
  begin
    insert into public.tenant_whatsapp_channels (tenant_id, waba_id, phone_number_id) values (a, '100000000000004', '200000000000004');
    raise exception 'a second live channel was accepted for the same tenant';
  exception when unique_violation then null; end;
  begin
    update public.tenant_whatsapp_channels set access_token_env = 'EAAG-plaintext-token' where id = channel_b;
    raise exception 'a raw token was accepted instead of an env var reference';
  exception when check_violation then null; end;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tenant_whatsapp_channels'
             and column_name in ('access_token', 'token', 'app_secret'))
    then raise exception 'channels must not store secrets'; end if;

  -- 3. Idempotent ingest: a Meta retry never duplicates.
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, '393331112222', 'Marie', 'wamid.TEST-0001', 'text', 'Bonjour', '{}'::jsonb, now());
  if not r.out_created or not r.out_conversation_created or r.out_tenant_id <> a
    then raise exception 'first ingest must create message + conversation for tenant A'; end if;
  first_message := r.out_message_id;
  first_conversation := r.out_conversation_id;
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, '393331112222', 'Marie', 'wamid.TEST-0001', 'text', 'Bonjour', '{}'::jsonb, now());
  if r.out_created or r.out_message_id <> first_message
    then raise exception 'duplicate webhook must return the existing message without creating'; end if;
  if (select count(*) from public.whatsapp_messages) <> 1
    then raise exception 'duplicate webhook created a second message'; end if;
  if (select unread_count from public.whatsapp_conversations where id = first_conversation) <> 1
    then raise exception 'duplicate webhook must not bump unread_count'; end if;
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, '393331112222', null, 'wamid.TEST-0002', 'text', 'Encore', '{}'::jsonb, now());
  if r.out_conversation_id <> first_conversation or r.out_conversation_created
    then raise exception 'second message must reuse the conversation'; end if;
  if (select customer_name from public.whatsapp_conversations where id = first_conversation) <> 'Marie'
    then raise exception 'a missing profile name must not erase the known one'; end if;

  -- 4. Cross-tenant isolation: the same customer number on tenant B is a different conversation of B.
  select * into r from public.ingest_whatsapp_inbound_message(channel_b, '393331112222', 'Marie B', 'wamid.TEST-0001', 'text', 'Ciao', '{}'::jsonb, now());
  if not r.out_created or r.out_tenant_id <> b or r.out_conversation_id = first_conversation
    then raise exception 'tenant B must get its own conversation for the same customer number'; end if;
  if exists (select 1 from public.whatsapp_messages m join public.whatsapp_conversations c on c.id = m.conversation_id
             where m.tenant_id <> c.tenant_id or m.channel_id <> c.channel_id)
    then raise exception 'a message is attached to a conversation of another tenant/channel'; end if;
  begin
    insert into public.whatsapp_messages (tenant_id, conversation_id, channel_id, direction, author_type, message_type, body, status)
    values (b, first_conversation, channel_a, 'outbound', 'automation', 'text', 'x', 'pending');
    raise exception 'tenant B could attach a message to a tenant A conversation';
  exception when foreign_key_violation then null; end;
  begin
    update public.whatsapp_conversations set customer_id = customer_b where id = first_conversation;
    raise exception 'a customer of tenant B was linked to a tenant A conversation';
  exception when check_violation then null; end;
  update public.whatsapp_conversations set customer_id = customer_a where id = first_conversation;

  -- 5. Disabled channel: ingest refused.
  update public.tenant_whatsapp_channels set status = 'disabled' where id = channel_b;
  begin
    perform public.ingest_whatsapp_inbound_message(channel_b, '393330000000', null, 'wamid.TEST-0003', 'text', 'x', '{}'::jsonb, now());
    raise exception 'a disabled channel accepted a message';
  exception when raise_exception then
    if sqlerrm <> 'whatsapp_channel_unavailable' then raise; end if;
  end;

  -- 6. Claim: a message is claimed once; a second claim gets nothing.
  if (select count(*) from public.claim_whatsapp_inbound_messages(10, array[first_message])) <> 1
    then raise exception 'pending message must be claimable'; end if;
  if (select count(*) from public.claim_whatsapp_inbound_messages(10, array[first_message])) <> 0
    then raise exception 'a message being processed must not be claimed twice'; end if;
  update public.whatsapp_messages set processing_started_at = now() - interval '10 minutes' where id = first_message;
  -- Stale A message + pending A message + pending B message.
  if (select count(*) from public.claim_whatsapp_inbound_messages(10, null)) <> 3
    then raise exception 'sweep must reclaim the stale message and claim the other pending ones'; end if;
  update public.whatsapp_messages set processing_status = 'pending', processing_attempts = 3 where id = first_message;
  perform public.claim_whatsapp_inbound_messages(10, null);
  if (select processing_status from public.whatsapp_messages where id = first_message) <> 'failed'
    then raise exception 'exhausted attempts must end as failed'; end if;

  -- 7. Monotonic delivery status.
  insert into public.whatsapp_messages (tenant_id, conversation_id, channel_id, provider_message_id, direction, author_type, message_type, body, status)
  values (a, first_conversation, channel_a, 'wamid.OUT-0001', 'outbound', 'automation', 'text', 'Réponse', 'sent') returning id into outbound;
  perform public.apply_whatsapp_message_status(channel_a, 'wamid.OUT-0001', 'read', now(), null, null);
  perform public.apply_whatsapp_message_status(channel_a, 'wamid.OUT-0001', 'delivered', now(), null, null);
  if (select status from public.whatsapp_messages where id = outbound) <> 'read'
    then raise exception 'a late delivered status must not downgrade read'; end if;
  if (select delivered_at is null or read_at is null from public.whatsapp_messages where id = outbound)
    then raise exception 'read implies delivered/read timestamps'; end if;
  perform public.apply_whatsapp_message_status(channel_a, 'wamid.OUT-0001', 'failed', now(), '131026', 'x');
  if (select status from public.whatsapp_messages where id = outbound) <> 'read'
    then raise exception 'failed after read must be ignored'; end if;
  if exists (select 1 from public.apply_whatsapp_message_status(channel_b, 'wamid.OUT-0001', 'read', now(), null, null))
    then raise exception 'a status from another channel must not match'; end if;

  -- 8. One open handoff per conversation.
  insert into public.whatsapp_handoffs (tenant_id, conversation_id, reason, assigned_to) values (a, first_conversation, 'customer_request', agent);
  begin
    insert into public.whatsapp_handoffs (tenant_id, conversation_id, reason) values (a, first_conversation, 'complaint');
    raise exception 'two open handoffs accepted';
  exception when unique_violation then null; end;

  -- 9. Rules: one row per code, unknown codes rejected.
  insert into public.whatsapp_automation_rules (tenant_id, code, configuration) values (a, 'greeting', '{"message": "Bonjour"}');
  begin
    insert into public.whatsapp_automation_rules (tenant_id, code) values (a, 'refund_everything');
    raise exception 'unknown rule code accepted';
  exception when check_violation then null; end;

  -- 10. Retention guard and purge.
  begin
    perform public.purge_expired_whatsapp_data(1, 365);
    raise exception 'a retention below 30 days was accepted';
  exception when raise_exception then
    if sqlerrm <> 'whatsapp_invalid_retention' then raise; end if;
  end;
  update public.whatsapp_conversations set last_message_at = now() - interval '400 days' where id = first_conversation;
  select * into r from public.purge_expired_whatsapp_data(180, 365);
  if r.out_deleted_conversations <> 1 or exists (select 1 from public.whatsapp_messages where conversation_id = first_conversation)
    then raise exception 'expired conversation must be purged with its messages'; end if;

  -- 11. RBAC catalogue.
  if (select count(*) from public.admin_permissions where key like 'whatsapp.%') <> 3
    then raise exception 'whatsapp capabilities missing'; end if;
  if exists (select 1 from public.admin_role_permissions rp join public.admin_roles ro on ro.id = rp.role_id
             where rp.permission_key like 'whatsapp.%' and ro.code not in ('platform_owner', 'tenant_admin'))
    then raise exception 'whatsapp capabilities must not be granted to other roles'; end if;
end $$;
rollback;
