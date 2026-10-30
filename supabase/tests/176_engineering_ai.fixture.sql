-- Minimal AI routing tables that migration 176 seeds into (the full ones come from migration 100).
-- Runs after the 175 fixture and the 175 migration, without dropping the schema.
create table public.ai_providers (id uuid primary key default gen_random_uuid(), key text unique not null);
create table public.ai_models (
  id uuid primary key default gen_random_uuid(), provider_id uuid references public.ai_providers(id), key text unique not null
);
create table public.ai_routing_policies (
  id uuid primary key default gen_random_uuid(), consumer text not null, capability text not null,
  enabled boolean not null default true, unique (consumer, capability)
);
create table public.ai_routing_policy_models (
  policy_id uuid not null references public.ai_routing_policies(id) on delete cascade,
  model_id uuid not null references public.ai_models(id) on delete cascade,
  priority integer not null, primary key (policy_id, model_id)
);
insert into public.ai_providers (key) values ('gemini');
insert into public.ai_models (provider_id, key) select id, 'gemini-nala-flash' from public.ai_providers where key = 'gemini';
insert into public.ai_routing_policies (consumer, capability) values ('nala', 'structured_chat');
