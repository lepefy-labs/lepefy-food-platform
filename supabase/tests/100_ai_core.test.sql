do $$
declare a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  lease uuid := gen_random_uuid(); c uuid; next_id uuid; rejected boolean;
begin
  c := public.open_ai_conversation(a,'nala',null,'fr',lease);
  rejected := false;
  begin perform public.open_ai_conversation(b,'nala',c,'fr',gen_random_uuid());
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Tenant isolation failed'; end if;
  rejected := false;
  begin perform public.open_ai_conversation(a,'nala',c,'fr',gen_random_uuid());
  exception when others then rejected := true; end;
  if not rejected then raise exception 'Concurrent lease failed'; end if;
  perform public.finish_ai_conversation(a,c,lease,'Le ndolé me tente','Je vous prépare le panier ?',
    '{"activeIntent":"meal_preparation","subject":{"type":"dish","name":"ndolé"},"pendingAction":"cart_builder"}',
    'model-a','a',null,'cart_builder');
  if (select count(*) from public.ai_conversation_turns where conversation_id = c) <> 2 then
    raise exception 'Atomic turns failed'; end if;
  lease := gen_random_uuid();
  next_id := public.open_ai_conversation(a,'nala',c,'fr',lease);
  if next_id <> c then raise exception 'Refresh failed'; end if;
  if (select working_memory->>'pendingAction' from public.ai_conversation_state where conversation_id = c) <> 'cart_builder' then
    raise exception 'Pending memory failed'; end if;
  perform public.finish_ai_conversation(a,c,lease,'Oui','Voici la sélection.',
    '{"activeIntent":"meal_preparation","subject":{"type":"dish","name":"ndolé"},"pendingAction":null}',
    'model-b','b',null,'cart_builder');
  if (select count(distinct provider_key) from public.ai_conversation_turns where conversation_id = c) <> 2 then
    raise exception 'Provider switch failed'; end if;
  update public.ai_conversations set expires_at = now() - interval '1 second' where id = c;
  next_id := public.open_ai_conversation(a,'nala',c,'fr',gen_random_uuid());
  if next_id = c then raise exception 'TTL failed'; end if;
  if exists(select 1 from public.ai_conversation_state where conversation_id = c) then raise exception 'Expired memory retained'; end if;
  update public.ai_conversation_turns set created_at = now() - interval '91 days' where conversation_id = c;
  perform public.purge_expired_ai_context();
  if exists(select 1 from public.ai_conversation_turns where conversation_id = c) then raise exception 'Raw retention failed'; end if;
  if has_table_privilege('anon','public.ai_conversations','SELECT')
    or has_table_privilege('authenticated','public.ai_models','UPDATE')
    or has_function_privilege('anon','public.open_ai_conversation(uuid,text,uuid,text,uuid)','EXECUTE') then
    raise exception 'Browser access leaked'; end if;
end;
$$;
