-- Minimal schema for 183: tenants, RBAC catalogue, storage buckets, AI Core
-- routing and audit catalogue.
drop schema public cascade;
create schema public;
drop schema if exists storage cascade;
create schema storage;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]
);

create table public.tenants (id uuid primary key, name text not null);
create table public.admin_permissions (
  key text primary key, module text not null, label text not null, description text,
  risk_level text not null default 'standard', position integer not null default 0, active boolean not null default true
);
create table public.admin_roles (id uuid primary key default gen_random_uuid(), code text not null unique);
create table public.admin_role_permissions (role_id uuid not null, permission_key text not null, primary key (role_id, permission_key));
create table public.audit_event_types (
  key text primary key, module text not null, category text not null, default_severity text not null, retention_class text not null
);
create table public.ai_providers (
  id uuid primary key default gen_random_uuid(), key text not null unique, name text not null,
  provider_type text not null, credential_ref text
);
create table public.ai_models (
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.ai_providers(id),
  key text not null unique, provider_model_id text not null, display_name text not null,
  capabilities jsonb not null default '{}', cost_class text, config jsonb not null default '{}', enabled boolean not null default true
);
create table public.ai_routing_policies (
  id uuid primary key default gen_random_uuid(), consumer text not null, capability text not null, unique (consumer, capability)
);
create table public.ai_routing_policy_models (
  policy_id uuid not null references public.ai_routing_policies(id) on delete cascade,
  model_id uuid not null references public.ai_models(id) on delete cascade,
  priority integer not null, timeout_ms integer not null default 12000 check (timeout_ms between 100 and 18000),
  primary key (policy_id, model_id)
);

create table public.ai_pricing (
  id uuid primary key default gen_random_uuid(), provider text not null, model text not null,
  input_price_per_million numeric, output_price_per_million numeric, image_price_flat numeric,
  active boolean not null default true, unique (provider, model)
);

insert into public.tenants (id, name) values
  ('10000000-0000-4000-8000-000000000001', 'Boutique A'),
  ('10000000-0000-4000-8000-000000000002', 'Boutique B');
insert into public.admin_roles (code) values ('platform_owner'), ('tenant_admin'), ('tenant_cashier');
insert into public.ai_providers (key, name, provider_type, credential_ref) values ('gemini', 'Google Gemini', 'gemini', 'GEMINI_API_KEY');
grant select on public.tenants to service_role;
