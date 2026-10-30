-- Engineering Hub, unit C: AI assistant plumbing (docs/engineering/AI_RETRIEVAL.md).
--
-- Additive and re-runnable. NOT applied automatically: the Platform Owner runs it.
--   * `engineering_settings`: one row per repository. AI is OFF by default (ai_enabled = false)
--     and has a daily budget and a per-minute limit.
--   * `engineering_api_clients`: machine credentials. Only the SHA-256 of the token is stored,
--     never the token. Scoped (search/read/ask), expirable, revocable.
--   * `engineering_query_metrics`: one row per search/ask (latency, tool calls, citations,
--     outcome). It stores a HASH and the length of the question, never its text.
--   * `engineering_ai_usage`: one row per model attempt (D2: the gateway runs for the
--     `engineering` consumer without a tenant and reports here instead of ai_usage_log).
--   * Routing policy ('engineering', 'structured_chat') is created DISABLED. Nothing can call a
--     model until the owner enables both the policy and `engineering_settings.ai_enabled`.
--   * No tenant column, RLS forced without policies, service role only (same stance as 175).

-- ─── 1. Settings (AI is off by default) ──────────────────────────────────────
create table if not exists public.engineering_settings (
  repository_id uuid primary key references public.engineering_repositories(id) on delete cascade,
  ai_enabled boolean not null default false,
  daily_budget_usd numeric(10,2) not null default 5 check (daily_budget_usd >= 0 and daily_budget_usd <= 1000),
  per_minute_limit integer not null default 10 check (per_minute_limit between 1 and 600),
  max_tool_calls integer not null default 6 check (max_tool_calls between 1 and 12),
  updated_at timestamptz not null default now()
);
insert into public.engineering_settings (repository_id)
select id from public.engineering_repositories
on conflict (repository_id) do nothing;

-- ─── 2. Machine credentials ──────────────────────────────────────────────────
create table if not exists public.engineering_api_clients (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.engineering_repositories(id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix text not null check (length(token_prefix) between 6 and 16),
  scopes text[] not null check (cardinality(scopes) >= 1 and scopes <@ array['search', 'read', 'ask']::text[]),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at and expires_at <= created_at + interval '1 year')
);
create index if not exists idx_engineering_clients_repo on public.engineering_api_clients(repository_id, created_at desc);

-- ─── 3. Metrics (hash of the question, never its text) ───────────────────────
create table if not exists public.engineering_query_metrics (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.engineering_repositories(id) on delete cascade,
  run_id uuid references public.engineering_index_runs(id) on delete set null,
  actor_kind text not null check (actor_kind in ('owner', 'machine')),
  client_id uuid references public.engineering_api_clients(id) on delete set null,
  kind text not null check (kind in ('search', 'ask')),
  question_hash text check (question_hash is null or question_hash ~ '^[0-9a-f]{64}$'),
  question_length integer check (question_length is null or question_length between 0 and 2000),
  outcome text not null check (outcome in ('ok', 'refused', 'no_answer', 'rate_limited', 'budget_exceeded', 'disabled', 'error')),
  refusal_reason text check (refusal_reason is null or length(refusal_reason) <= 60),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  tool_calls integer not null default 0 check (tool_calls between 0 and 50),
  citations integer not null default 0 check (citations between 0 and 100),
  dropped_citations integer not null default 0 check (dropped_citations between 0 and 100),
  result_count integer check (result_count is null or result_count >= 0),
  created_at timestamptz not null default now()
);
create index if not exists idx_engineering_metrics_time on public.engineering_query_metrics(repository_id, created_at desc);
create index if not exists idx_engineering_metrics_actor on public.engineering_query_metrics(repository_id, actor_kind, client_id, created_at desc);

create table if not exists public.engineering_ai_usage (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid references public.engineering_repositories(id) on delete set null,
  endpoint text not null check (length(endpoint) <= 80),
  provider text not null,
  model text not null,
  status text not null check (status in ('success', 'error', 'rate_limited')),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd numeric(12,6) not null default 0 check (estimated_cost_usd >= 0),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  fallback_used boolean not null default false,
  fallback_reason text,
  created_at timestamptz not null default now()
);
create index if not exists idx_engineering_ai_usage_time on public.engineering_ai_usage(created_at desc);

-- ─── 4. Machine authentication (updates last_used_at) ────────────────────────
create or replace function public.engineering_authenticate_client(p_token_hash text, p_scope text)
returns table (out_client_id uuid, out_repository_id uuid, out_scopes text[])
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  update public.engineering_api_clients c
     set last_used_at = now()
   where c.token_hash = p_token_hash
     and c.revoked_at is null
     and c.expires_at > now()
     and p_scope = any(c.scopes)
  returning c.id, c.repository_id, c.scopes;
end;
$$;

-- ─── 5. Retention of metrics (180 days) ──────────────────────────────────────
create or replace function public.engineering_purge_metrics(p_days integer default 180)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a integer; v_b integer;
begin
  delete from public.engineering_query_metrics where created_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics v_a = row_count;
  delete from public.engineering_ai_usage where created_at < now() - make_interval(days => greatest(p_days, 30));
  get diagnostics v_b = row_count;
  return v_a + v_b;
end;
$$;

-- ─── 6. Routing policy: created DISABLED, no spending until the owner enables it ──
do $$
begin
  if to_regclass('public.ai_routing_policies') is not null then
    insert into public.ai_routing_policies (consumer, capability, enabled)
    values ('engineering', 'structured_chat', false)
    on conflict (consumer, capability) do nothing;
    insert into public.ai_routing_policy_models (policy_id, model_id, priority)
    select p.id, m.id, 1
    from public.ai_routing_policies p join public.ai_models m on m.key = 'gemini-nala-flash'
    where p.consumer = 'engineering' and p.capability = 'structured_chat'
    on conflict (policy_id, model_id) do nothing;
  end if;
end;
$$;

-- ─── 7. Privileges: service role only, RLS forced with no policy ─────────────
do $$
declare t text;
begin
  foreach t in array array['engineering_settings', 'engineering_api_clients', 'engineering_query_metrics', 'engineering_ai_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end;
$$;
grant select, insert, update on public.engineering_settings, public.engineering_api_clients to service_role;
grant select, insert on public.engineering_query_metrics, public.engineering_ai_usage to service_role;

revoke all on function public.engineering_authenticate_client(text, text), public.engineering_purge_metrics(integer)
  from public, anon, authenticated;
grant execute on function public.engineering_authenticate_client(text, text), public.engineering_purge_metrics(integer) to service_role;

-- Rollback (manual, destroys settings, credentials and metrics only; the index is untouched):
-- drop function if exists public.engineering_purge_metrics(integer);
-- drop function if exists public.engineering_authenticate_client(text, text);
-- drop table if exists public.engineering_ai_usage, public.engineering_query_metrics, public.engineering_api_clients, public.engineering_settings;
-- delete from public.ai_routing_policies where consumer = 'engineering';
