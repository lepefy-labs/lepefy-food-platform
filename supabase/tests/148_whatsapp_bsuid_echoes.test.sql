-- Runs on the 147 fixture after 147 then 148 (twice).
begin;
do $$
declare
  a constant uuid := '11111111-1111-4111-8111-111111111111';
  b constant uuid := '22222222-2222-4222-8222-222222222222';
  channel_a uuid;
  channel_b uuid;
  r record;
  conv uuid;
  conv_user_only uuid;
  echo_msg uuid;
begin
  insert into public.tenant_whatsapp_channels (tenant_id, waba_id, phone_number_id, status)
  values (a, '100000000000001', '200000000000001', 'active') returning id into channel_a;
  insert into public.tenant_whatsapp_channels (tenant_id, waba_id, phone_number_id, status)
  values (b, '100000000000002', '200000000000002', 'active') returning id into channel_b;

  -- 1. Phone + BSUID: one conversation, both identifiers stored.
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, '393331112222', 'Marie', 'wamid.BSUID-0001', 'text', 'Ciao', '{}'::jsonb, now(), 'IT.111');
  conv := r.out_conversation_id;
  if not r.out_created or (select wa_user_id from public.whatsapp_conversations where id = conv) <> 'IT.111'
    then raise exception 'BSUID must be stored with the phone number'; end if;

  -- 2. Same customer later without phone (username adopted): resolved by BSUID, not duplicated.
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, null, null, 'wamid.BSUID-0002', 'text', 'Encore', '{}'::jsonb, now(), 'IT.111');
  if r.out_conversation_id <> conv then raise exception 'BSUID-only message must reuse the conversation'; end if;

  -- 3. Username-only customer: conversation without phone.
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, null, 'Jean', 'wamid.BSUID-0003', 'text', 'Bonjour', '{}'::jsonb, now(), 'FR.222');
  conv_user_only := r.out_conversation_id;
  if (select wa_id is not null or customer_phone is not null from public.whatsapp_conversations where id = conv_user_only)
    then raise exception 'username-only customer must have no phone'; end if;

  -- 4. Phone appears later: completed on the same conversation.
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, '33612345678', null, 'wamid.BSUID-0004', 'text', 'x', '{}'::jsonb, now(), 'FR.222');
  if r.out_conversation_id <> conv_user_only
     or (select customer_phone from public.whatsapp_conversations where id = conv_user_only) <> '+33612345678'
    then raise exception 'phone must complete the BSUID conversation'; end if;

  -- 5. Identity constraints.
  begin
    perform public.ingest_whatsapp_inbound_message(channel_a, null, null, 'wamid.BSUID-0005', 'text', 'x', '{}'::jsonb, now(), null);
    raise exception 'message without any identity accepted';
  exception when raise_exception then
    if sqlerrm <> 'whatsapp_identity_missing' then raise; end if;
  end;
  begin
    update public.whatsapp_conversations set wa_user_id = 'not a bsuid' where id = conv;
    raise exception 'malformed BSUID accepted';
  exception when check_violation then null; end;

  -- 6. Same BSUID on tenant B = separate conversation (BSUIDs are portfolio-scoped anyway).
  select * into r from public.ingest_whatsapp_inbound_message(channel_b, null, null, 'wamid.BSUID-0001', 'text', 'x', '{}'::jsonb, now(), 'IT.111');
  if r.out_tenant_id <> b or r.out_conversation_id = conv then raise exception 'cross-tenant BSUID must not share a conversation'; end if;

  -- 7. 147 signature still works (deploy window).
  select * into r from public.ingest_whatsapp_inbound_message(channel_a, '393339998888', null, 'wamid.LEGACY-0001', 'text', 'x', '{}'::jsonb, now());
  if not r.out_created then raise exception '147 signature must keep working'; end if;

  -- 8. Business app echo: stored as agent outbound, automation paused with auto-resume, idempotent.
  select * into r from public.ingest_whatsapp_business_echo(channel_a, '393331112222', null, 'wamid.ECHO-0001', 'text', 'Réponse du magasin', '{}'::jsonb, now(), 60);
  echo_msg := r.out_message_id;
  if not r.out_created or r.out_conversation_id <> conv then raise exception 'echo must attach to the customer conversation'; end if;
  if (select direction <> 'outbound' or author_type <> 'agent' or author_admin_id is not null or metadata->>'source' <> 'business_app'
      from public.whatsapp_messages where id = echo_msg)
    then raise exception 'echo must be an agent outbound message from the business app'; end if;
  if (select status <> 'human' or automation_status <> 'paused' or automation_resume_at is null from public.whatsapp_conversations where id = conv)
    then raise exception 'echo must pause automation with auto-resume'; end if;
  if (select count(*) from public.whatsapp_handoffs where conversation_id = conv and resolved_at is null and accepted_at is not null) <> 1
    then raise exception 'echo must open an accepted handoff'; end if;
  select * into r from public.ingest_whatsapp_business_echo(channel_a, '393331112222', null, 'wamid.ECHO-0001', 'text', 'Réponse du magasin', '{}'::jsonb, now(), 60);
  if r.out_created or r.out_message_id <> echo_msg then raise exception 'echo retry must not duplicate'; end if;
  if (select count(*) from public.whatsapp_audit_events where conversation_id = conv and event_type = 'business_app_reply') <> 1
    then raise exception 'echo audit must be written once'; end if;

  -- 9. Echo to a customer who never wrote creates the conversation; manual resume = null resume_at.
  select * into r from public.ingest_whatsapp_business_echo(channel_a, '393330001111', null, 'wamid.ECHO-0002', 'text', 'Bonjour', '{}'::jsonb, now(), null);
  if (select automation_resume_at is not null from public.whatsapp_conversations where id = r.out_conversation_id)
    then raise exception 'null resume minutes must keep manual resume'; end if;

  -- 10. Grants.
  if has_function_privilege('anon', 'public.ingest_whatsapp_business_echo(uuid, text, text, text, text, text, jsonb, timestamptz, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.ingest_whatsapp_inbound_message(uuid, text, text, text, text, text, jsonb, timestamptz, text)', 'execute')
     or has_function_privilege('anon', 'public.whatsapp_resolve_conversation(uuid, uuid, text, text, text, timestamptz)', 'execute')
    then raise exception '148 RPCs must not be executable by browser roles'; end if;
end $$;
rollback;
