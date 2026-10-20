-- Minimal schema for 161: orders + order_items as read by the views, admin
-- users, the audit catalogue and a recording stub of the 153 audit writer.
drop schema public cascade;
create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.admin_users (id uuid primary key);
create table public.orders (
  id uuid primary key, tenant_id uuid not null, status text not null default 'new',
  fulfillment_type text not null default 'delivery', payment_status text not null default 'paid',
  created_at timestamptz not null default now(), total numeric(12,2) not null default 10,
  tracking_code text, packing_completed_at timestamptz, cold_chain_packing_checked_at timestamptz,
  updated_at timestamptz not null default now()
);
create table public.order_items (
  id uuid primary key default gen_random_uuid(), order_id uuid not null, storage_type text,
  picked_at timestamptz, cold_chain_checked_at timestamptz
);
create table public.audit_event_types (
  key text primary key, module text not null, category text not null, default_severity text not null, retention_class text not null
);
create table public.audit_events_test (event_type text, resource_id text, metadata jsonb);
create or replace function public.audit_emit(
  p_strict boolean, p_tenant_id uuid, p_event_type text, p_resource_type text, p_resource_id text, p_resource_label text,
  p_changes jsonb, p_metadata jsonb, p_outcome text default 'success', p_severity text default null, p_actor jsonb default null
) returns void language plpgsql as $$
begin
  insert into public.audit_events_test values (p_event_type, p_resource_id, p_metadata);
end $$;
create or replace function public.audit_note_failure(p_tenant_id uuid, p_event_type text, p_sqlstate text, p_message text)
returns void language plpgsql as $$ begin raise exception 'audit failure % %', p_event_type, p_message; end $$;

insert into public.admin_users (id) values ('20000000-0000-4000-8000-000000000001');
insert into public.orders (id, tenant_id, status) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'new'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'preparing'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'cancelled');
