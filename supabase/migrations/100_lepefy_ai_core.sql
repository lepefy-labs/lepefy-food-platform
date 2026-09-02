-- Lepefy AI Core V1. Additive. Apply before the canonical persistent runtime is used.
begin;
create table public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, name text not null,
  provider_type text not null check (provider_type in ('lepefy','gemini','openai','anthropic','openai_compatible')),
  enabled boolean not null default true,
  credential_ref text check (credential_ref is null or credential_ref ~ '^[A-Z][A-Z0-9_]*_API_KEY$'),
  base_url text, config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  health_status text not null default 'unknown' check (health_status in ('unknown','healthy','degraded','unhealthy')),
  last_health_check_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ai_models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  key text not null unique, provider_model_id text not null, display_name text not null,
  enabled boolean not null default true,
  capabilities jsonb not null default '{}' check (jsonb_typeof(capabilities) = 'object'),
  context_window integer check (context_window > 0), cost_class text,
  input_cost_per_million numeric check (input_cost_per_million >= 0),
  output_cost_per_million numeric check (output_cost_per_million >= 0),
  config jsonb not null default '{}' check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.ai_routing_policies (
  id uuid primary key default gen_random_uuid(), consumer text not null, capability text not null,
  enabled boolean not null default true, config jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (consumer, capability)
);
create table public.ai_routing_policy_models (
  policy_id uuid not null references public.ai_routing_policies(id) on delete cascade,
  model_id uuid not null references public.ai_models(id) on delete cascade,
  priority integer not null check (priority >= 0), enabled boolean not null default true,
  timeout_ms integer not null default 12000 check (timeout_ms between 100 and 18000),
  min_confidence numeric check (min_confidence between 0 and 1),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key (policy_id, model_id)
);
comment on column public.ai_routing_policy_models.priority is
  'Lower priority runs first; equal priority is ordered by model key. Gateway total budget: 18 seconds.';

create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  consumer text not null, customer_id uuid references public.customers(id) on delete set null,
  locale text check (length(locale) <= 35),
  status text not null default 'active' check (status in ('active','closed','expired')),
  last_activity_at timestamptz not null default now(), expires_at timestamptz,
  lease_id uuid, lease_expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index ai_conversations_expiry_idx on public.ai_conversations(expires_at);
create index ai_conversations_tenant_idx on public.ai_conversations(tenant_id, consumer, last_activity_at);
create table public.ai_conversation_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  sequence bigint generated always as identity,
  role text not null check (role in ('user','assistant','system')),
  content text not null check (length(content) <= 2000),
  runtime_intent text, runtime_confidence numeric check (runtime_confidence between 0 and 1),
  runtime_commerce_mode text, provider_key text, model_key text,
  created_at timestamptz not null default now()
);
create index ai_conversation_turns_sequence_idx on public.ai_conversation_turns(conversation_id, sequence desc);
create index ai_conversation_turns_retention_idx on public.ai_conversation_turns(created_at);
create table public.ai_conversation_state (
  conversation_id uuid primary key references public.ai_conversations(id) on delete cascade,
  context_version text not null default 'v1',
  working_memory jsonb not null default '{}' check (jsonb_typeof(working_memory) = 'object' and octet_length(working_memory::text) <= 4000),
  rolling_summary text check (length(rolling_summary) <= 2000),
  last_compacted_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.ai_usage_log
  add column consumer text, add column capability text, add column latency_ms integer,
  add column fallback_used boolean, add column fallback_reason text;

create function public.touch_ai_core_updated_at() returns trigger language plpgsql
set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
do $$
declare t text;
begin
  foreach t in array array['ai_providers','ai_models','ai_routing_policies','ai_routing_policy_models',
    'ai_conversations','ai_conversation_state'] loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_ai_core_updated_at()', t);
  end loop;
  foreach t in array array['ai_providers','ai_models','ai_routing_policies','ai_routing_policy_models',
    'ai_conversations','ai_conversation_turns','ai_conversation_state'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end;
$$;
grant usage, select on sequence public.ai_conversation_turns_sequence_seq to service_role;
revoke all on function public.touch_ai_core_updated_at() from public, anon, authenticated;

insert into public.ai_providers (key, name, provider_type, credential_ref)
values ('gemini', 'Google Gemini', 'gemini', 'GEMINI_API_KEY');
insert into public.ai_models (provider_id, key, provider_model_id, display_name, capabilities, config)
select id, 'gemini-nala-flash', 'gemini-2.5-flash', 'Gemini Flash',
  '{"chat":true,"structured_output":true,"classification":true}', '{"thinkingBudget":0}'
from public.ai_providers where key = 'gemini';
insert into public.ai_routing_policies (consumer, capability) values ('nala','structured_chat');
insert into public.ai_routing_policy_models (policy_id, model_id, priority)
select p.id, m.id, 1 from public.ai_routing_policies p cross join public.ai_models m
where p.consumer = 'nala' and p.capability = 'structured_chat' and m.key = 'gemini-nala-flash';

-- UUID is a server-generated bearer identifier. Never accept client-chosen IDs for new conversations.
-- A short lease serializes turns across requests and expires after a crashed runtime.
create function public.open_ai_conversation(
  p_tenant_id uuid, p_consumer text, p_conversation_id uuid, p_locale text, p_lease uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare c public.ai_conversations%rowtype; resolved uuid;
begin
  if p_conversation_id is not null then
    select * into c from public.ai_conversations where id = p_conversation_id for update;
    if found then
      if c.tenant_id <> p_tenant_id or c.consumer <> p_consumer then
        raise exception 'conversation_unavailable';
      end if;
      if c.status = 'active' and c.expires_at > now() then
        if c.lease_expires_at > now() then raise exception 'conversation_busy'; end if;
        update public.ai_conversations set lease_id = p_lease, lease_expires_at = now() + interval '90 seconds',
          last_activity_at = now(), expires_at = now() + interval '2 hours' where id = c.id;
        return c.id;
      end if;
      update public.ai_conversations set status = 'expired', lease_id = null, lease_expires_at = null where id = c.id;
      delete from public.ai_conversation_state where conversation_id = c.id;
    end if;
  end if;
  insert into public.ai_conversations(tenant_id, consumer, locale, expires_at, lease_id, lease_expires_at)
  values (p_tenant_id, p_consumer, p_locale, now() + interval '2 hours', p_lease, now() + interval '90 seconds')
  returning id into resolved;
  insert into public.ai_conversation_state(conversation_id) values (resolved);
  return resolved;
end;
$$;
create function public.finish_ai_conversation(
  p_tenant_id uuid, p_conversation_id uuid, p_lease uuid,
  p_message text, p_reply text, p_memory jsonb, p_provider text, p_model text,
  p_confidence numeric, p_commerce_mode text
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.ai_conversations where id = p_conversation_id and tenant_id = p_tenant_id
    and status = 'active' and lease_id = p_lease and lease_expires_at > now() for update;
  if not found then raise exception 'conversation_unavailable'; end if;
  insert into public.ai_conversation_turns(conversation_id, role, content)
    values (p_conversation_id, 'user', p_message);
  insert into public.ai_conversation_turns(conversation_id, role, content, runtime_intent,
    runtime_confidence, runtime_commerce_mode, provider_key, model_key)
    values (p_conversation_id, 'assistant', p_reply, p_memory->>'activeIntent',
      p_confidence, p_commerce_mode, p_provider, p_model);
  update public.ai_conversation_state set working_memory = p_memory where conversation_id = p_conversation_id;
  update public.ai_conversations set last_activity_at = now(), expires_at = now() + interval '2 hours',
    lease_id = null, lease_expires_at = null where id = p_conversation_id;
end;
$$;
create function public.purge_expired_ai_context() returns bigint
language plpgsql security definer set search_path = public as $$
declare deleted_count bigint;
begin
  update public.ai_conversations set status = 'expired', lease_id = null, lease_expires_at = null
    where status = 'active' and expires_at <= now() and (lease_expires_at is null or lease_expires_at <= now());
  delete from public.ai_conversation_state s using public.ai_conversations c
    where s.conversation_id = c.id and c.status <> 'active';
  delete from public.ai_conversation_turns where created_at < now() - interval '90 days';
  delete from public.ai_conversations where last_activity_at < now() - interval '90 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.open_ai_conversation(uuid,text,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.finish_ai_conversation(uuid,uuid,uuid,text,text,jsonb,text,text,numeric,text) from public, anon, authenticated;
revoke all on function public.purge_expired_ai_context() from public, anon, authenticated;
grant execute on function public.open_ai_conversation(uuid,text,uuid,text,uuid) to service_role;
grant execute on function public.finish_ai_conversation(uuid,uuid,uuid,text,text,jsonb,text,text,numeric,text) to service_role;
grant execute on function public.purge_expired_ai_context() to service_role;
comment on table public.ai_conversation_state is 'Short-term conversation memory. Removed on expiry. No cross-session profiling.';
comment on function public.purge_expired_ai_context() is 'Invoke from existing approved service-role maintenance job; raw retention maximum 90 days.';
commit;
