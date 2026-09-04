do $$
declare
  memory_id uuid;
  hits bigint;
  before_kb timestamptz;
  after_kb timestamptz;
  purged bigint;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tenant_knowledge_base' and column_name = 'updated_at'
  ) then
    raise exception 'tenant_knowledge_base.updated_at missing';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'nala_response_memory' and c.relrowsecurity = true
  ) then
    raise exception 'nala_response_memory RLS missing';
  end if;

  if has_table_privilege('anon', 'public.nala_response_memory', 'SELECT')
     or has_table_privilege('authenticated', 'public.nala_response_memory', 'SELECT')
     or has_table_privilege('authenticated', 'public.nala_response_memory', 'INSERT') then
    raise exception 'browser role received response memory privileges';
  end if;
  if not has_table_privilege('service_role', 'public.nala_response_memory', 'SELECT')
     or not has_table_privilege('service_role', 'public.nala_response_memory', 'INSERT')
     or not has_table_privilege('service_role', 'public.nala_response_memory', 'UPDATE') then
    raise exception 'service_role response memory privileges missing';
  end if;

  if has_function_privilege('anon', 'public.touch_nala_response_memory(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.purge_expired_nala_response_memory()', 'EXECUTE') then
    raise exception 'browser role received response memory RPC privileges';
  end if;
  if not has_function_privilege('service_role', 'public.touch_nala_response_memory(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.purge_expired_nala_response_memory()', 'EXECUTE') then
    raise exception 'service_role response memory RPC privileges missing';
  end if;

  select updated_at into before_kb
  from public.tenant_knowledge_base
  where id = '33333333-3333-4333-8333-333333333333';
  perform pg_sleep(0.01);
  update public.tenant_knowledge_base
  set content = 'Knowledge fixture updated'
  where id = '33333333-3333-4333-8333-333333333333';
  select updated_at into after_kb
  from public.tenant_knowledge_base
  where id = '33333333-3333-4333-8333-333333333333';
  if after_kb <= before_kb then
    raise exception 'knowledge updated_at trigger did not advance';
  end if;

  insert into public.nala_response_memory(
    tenant_id, locale, query_family, normalized_query, query_terms, intent, subject_key,
    reply, decision, tenant_version, knowledge_revision, context_fingerprint,
    source_provider, source_model
  ) values (
    '11111111-1111-4111-8111-111111111111',
    'fr', 'definition', 'definition safou', array['definition','safou'],
    'product_information', 'safou', 'Le safou est un fruit africain.',
    '{"intent":"product_information","commerceMode":"none","confidence":0.9,"subject":{"type":"product","name":"Safou"},"entities":{"dish":null,"product":"Safou"},"pendingAction":null}'::jsonb,
    now(), '1:test', repeat('a', 64), 'gemini', 'gemini-test'
  ) returning id into memory_id;

  perform public.touch_nala_response_memory('22222222-2222-4222-8222-222222222222', memory_id);
  select hit_count into hits from public.nala_response_memory where id = memory_id;
  if hits <> 0 then raise exception 'cross-tenant memory touch succeeded'; end if;

  perform public.touch_nala_response_memory('11111111-1111-4111-8111-111111111111', memory_id);
  select hit_count into hits from public.nala_response_memory where id = memory_id;
  if hits <> 1 then raise exception 'tenant memory touch failed'; end if;

  update public.nala_response_memory set expires_at = now() - interval '1 minute' where id = memory_id;
  select public.purge_expired_nala_response_memory() into purged;
  if purged < 1 or exists(select 1 from public.nala_response_memory where id = memory_id) then
    raise exception 'response memory retention purge failed';
  end if;
end;
$$;
