-- Minimal schema for 160: catalogue of modules, tenant settings, orders and
-- admin users, plus a recording stub of the 153 audit writer, on a throwaway
-- database (same pattern as the other self-contained fixtures).
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.platform_features (
  key text primary key, name text not null, description text, category text, active boolean not null default true,
  billable boolean not null default false, position integer, updated_at timestamptz not null default now()
);
create table public.tenant_feature_settings (
  tenant_id uuid not null, feature_key text not null, enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_key)
);
create table public.admin_users (id uuid primary key);
create table public.orders (
  id uuid primary key, tenant_id uuid not null, status text not null default 'preparing',
  packing_parcel_count integer, updated_at timestamptz not null default now()
);
create table public.audit_event_types (
  key text primary key, module text not null, category text not null, default_severity text not null, retention_class text not null
);

-- Recording stub of audit_emit (153): same signature, events land in a test table.
create table public.audit_events_test (event_type text, resource_id text, metadata jsonb, severity text);
create or replace function public.audit_emit(
  p_strict boolean, p_tenant_id uuid, p_event_type text, p_resource_type text, p_resource_id text, p_resource_label text,
  p_changes jsonb, p_metadata jsonb, p_outcome text default 'success', p_severity text default null, p_actor jsonb default null
) returns void language plpgsql as $$
begin
  insert into public.audit_events_test values (p_event_type, p_resource_id, p_metadata, p_severity);
end $$;
create or replace function public.audit_note_failure(p_tenant_id uuid, p_event_type text, p_sqlstate text, p_message text)
returns void language plpgsql as $$ begin raise exception 'audit failure % %', p_event_type, p_message; end $$;

insert into public.admin_users (id) values ('20000000-0000-4000-8000-000000000001');
insert into public.orders (id, tenant_id, status) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'preparing'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'new');
