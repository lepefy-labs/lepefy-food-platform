-- Minimal schema for 163: tenants, admin users, RBAC catalogue, storage
-- buckets, AI routing, audit catalogue and a recording stub of the 153 writer.
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

create table public.tenants (id uuid primary key, name text not null, slug text not null unique);
create table public.admin_users (id uuid primary key, role text not null, active boolean not null default true);
create table public.admin_permissions (
  key text primary key, module text not null, label text not null, description text,
  risk_level text not null default 'standard', position integer not null default 0
);
create table public.admin_roles (id uuid primary key default gen_random_uuid(), code text not null unique);
create table public.admin_role_permissions (role_id uuid not null, permission_key text not null, primary key (role_id, permission_key));
create table public.audit_event_types (
  key text primary key, module text not null, category text not null, default_severity text not null, retention_class text not null
);
create table public.audit_events_test (event_type text, resource_id text, changes jsonb, metadata jsonb);
create or replace function public.audit_emit(
  p_strict boolean, p_tenant_id uuid, p_event_type text, p_resource_type text, p_resource_id text, p_resource_label text,
  p_changes jsonb, p_metadata jsonb, p_outcome text default 'success', p_severity text default null, p_actor jsonb default null
) returns void language plpgsql as $$
begin
  insert into public.audit_events_test values (p_event_type, p_resource_id, p_changes, p_metadata);
end $$;

create table public.ai_models (id uuid primary key default gen_random_uuid(), key text not null unique);
create table public.ai_routing_policies (
  id uuid primary key default gen_random_uuid(), consumer text not null, capability text not null, unique (consumer, capability)
);
create table public.ai_routing_policy_models (
  policy_id uuid not null references public.ai_routing_policies(id) on delete cascade,
  model_id uuid not null references public.ai_models(id) on delete cascade,
  priority integer not null, timeout_ms integer not null default 12000,
  primary key (policy_id, model_id)
);

insert into public.tenants (id, name, slug) values
  ('10000000-0000-4000-8000-000000000001', 'Boutique A', 'boutique-a'),
  ('10000000-0000-4000-8000-000000000002', 'Boutique B', 'boutique-b');
insert into public.admin_users (id, role) values
  ('20000000-0000-4000-8000-000000000001', 'tenant_admin'),    -- boutique A
  ('20000000-0000-4000-8000-000000000002', 'tenant_admin'),    -- boutique A, collègue
  ('20000000-0000-4000-8000-000000000003', 'tenant_admin'),    -- boutique B
  ('20000000-0000-4000-8000-000000000009', 'platform_owner');
insert into public.admin_roles (code) values ('platform_owner'), ('tenant_admin'), ('tenant_cashier');
insert into public.ai_models (key) values ('gemini-nala-flash');
insert into public.ai_routing_policies (consumer, capability) values ('nala', 'structured_chat');
insert into public.ai_routing_policy_models (policy_id, model_id, priority, timeout_ms)
select p.id, m.id, 1, 15000 from public.ai_routing_policies p cross join public.ai_models m;
grant select on public.tenants, public.admin_users to service_role;
