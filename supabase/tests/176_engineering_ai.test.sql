-- 176: Engineering Hub AI plumbing — AI off by default, disabled routing policy, hashed credentials,
-- scope/expiry/revocation, metrics without question text, privileges.
do $$
declare
  v_repo uuid;
  v_client uuid;
  v_hash text := repeat('ab', 32);
  v_n integer;
  v_row record;
begin
  select id into v_repo from public.engineering_repositories where slug = 'lepefy-food-platform';

  -- Settings: one row, AI off.
  if not exists (select 1 from public.engineering_settings where repository_id = v_repo and ai_enabled = false) then raise exception 'AI must be disabled by default'; end if;

  -- Routing policy exists and is DISABLED; the Nala policy is untouched.
  if not exists (select 1 from public.ai_routing_policies where consumer = 'engineering' and capability = 'structured_chat' and enabled = false) then raise exception 'engineering policy missing or enabled'; end if;
  if (select count(*) from public.ai_routing_policies where consumer = 'engineering') <> 1 then raise exception 'duplicate policy after re-run'; end if;
  if not (select enabled from public.ai_routing_policies where consumer = 'nala') then raise exception 'nala policy changed'; end if;

  -- Credentials: a token must not fit (only a sha-256 hex), scopes and lifetime are bounded.
  begin
    insert into public.engineering_api_clients (repository_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_repo, 'bad', 'lpe_eng_plain_token', 'lpe_en', array['search'], now() + interval '1 day');
    raise exception 'plain token accepted';
  exception when check_violation then null; end;
  begin
    insert into public.engineering_api_clients (repository_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_repo, 'bad scope', v_hash, 'lpe_en', array['admin'], now() + interval '1 day');
    raise exception 'unknown scope accepted';
  exception when check_violation then null; end;
  begin
    insert into public.engineering_api_clients (repository_id, name, token_hash, token_prefix, scopes, expires_at)
    values (v_repo, 'too long', v_hash, 'lpe_en', array['search'], now() + interval '2 years');
    raise exception 'lifetime beyond one year accepted';
  exception when check_violation then null; end;

  insert into public.engineering_api_clients (repository_id, name, token_hash, token_prefix, scopes, expires_at)
  values (v_repo, 'ci', v_hash, 'lpe_en', array['search', 'read'], now() + interval '30 days') returning id into v_client;

  -- Authentication: right scope passes and stamps last_used_at; wrong scope, wrong hash fail.
  select * into v_row from public.engineering_authenticate_client(v_hash, 'search');
  if v_row.out_client_id is distinct from v_client then raise exception 'authentication failed'; end if;
  if (select last_used_at from public.engineering_api_clients where id = v_client) is null then raise exception 'last_used_at not stamped'; end if;
  if exists (select 1 from public.engineering_authenticate_client(v_hash, 'ask')) then raise exception 'scope not enforced'; end if;
  if exists (select 1 from public.engineering_authenticate_client(repeat('cd', 32), 'search')) then raise exception 'unknown token accepted'; end if;

  -- Revoked and expired credentials stop working.
  update public.engineering_api_clients set revoked_at = now() where id = v_client;
  if exists (select 1 from public.engineering_authenticate_client(v_hash, 'search')) then raise exception 'revoked token accepted'; end if;
  update public.engineering_api_clients set revoked_at = null, expires_at = now() - interval '1 second', created_at = now() - interval '2 days' where id = v_client;
  if exists (select 1 from public.engineering_authenticate_client(v_hash, 'search')) then raise exception 'expired token accepted'; end if;

  -- Metrics: hash and length only; there is no column that could hold the question text.
  if exists (select 1 from information_schema.columns where table_name = 'engineering_query_metrics' and column_name in ('question', 'question_text', 'query', 'answer')) then raise exception 'metrics may store text'; end if;
  insert into public.engineering_query_metrics (repository_id, actor_kind, kind, question_hash, question_length, outcome, tool_calls, citations)
  values (v_repo, 'owner', 'ask', v_hash, 42, 'ok', 2, 3);
  begin
    insert into public.engineering_query_metrics (repository_id, actor_kind, kind, outcome) values (v_repo, 'machine', 'ask', 'success');
    raise exception 'unknown outcome accepted';
  exception when check_violation then null; end;

  -- AI usage has no tenant column and no free-form prompt column.
  if exists (select 1 from information_schema.columns where table_name = 'engineering_ai_usage' and column_name in ('tenant_id', 'prompt', 'response')) then raise exception 'ai usage columns unexpected'; end if;

  -- Retention: rows older than the horizon go, recent ones stay; the floor is 30 days.
  insert into public.engineering_query_metrics (repository_id, actor_kind, kind, outcome, created_at) values (v_repo, 'owner', 'search', 'ok', now() - interval '400 days');
  v_n := public.engineering_purge_metrics(1);
  if v_n < 1 then raise exception 'old metrics not purged'; end if;
  if (select count(*) from public.engineering_query_metrics where created_at > now() - interval '1 day') < 1 then raise exception 'recent metrics purged by a 1-day horizon'; end if;

  -- Re-running the seed is idempotent.
  if (select count(*) from public.engineering_settings) <> 1 then raise exception 'settings duplicated'; end if;
end;
$$;

-- Privileges: nobody but the service role, and the service role cannot delete or rewrite metrics.
set role anon;
do $$ begin
  begin perform 1 from public.engineering_api_clients; raise exception 'anon reads credentials'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.engineering_settings; raise exception 'anon reads settings'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ begin
  begin perform 1 from public.engineering_query_metrics; raise exception 'authenticated reads metrics'; exception when insufficient_privilege then null; end;
  begin perform public.engineering_authenticate_client(repeat('ab', 32), 'search'); raise exception 'authenticated calls auth rpc'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$ begin
  perform 1 from public.engineering_api_clients;
  begin delete from public.engineering_query_metrics; raise exception 'service role deleted metrics'; exception when insufficient_privilege then null; end;
  begin update public.engineering_query_metrics set outcome = 'ok'; raise exception 'service role rewrote metrics'; exception when insufficient_privilege then null; end;
  begin delete from public.engineering_api_clients; raise exception 'service role deleted credentials'; exception when insufficient_privilege then null; end;
end $$;
reset role;
