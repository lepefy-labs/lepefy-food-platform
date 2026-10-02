-- Minimal schema before 143 on a throwaway database: recipients still carry the
-- legacy notify_* flags. notify_rental_reservations is deliberately missing to
-- prove the backfill only reads the columns that exist.
drop schema public cascade;
create schema public;
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create table public.tenants (
  id uuid primary key,
  slug text unique not null,
  name text not null
);

create table public.admin_users (
  id uuid primary key,
  email text not null,
  tenant_id uuid references public.tenants(id),
  active boolean not null default true
);

create table public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  active boolean not null default true
);

create table public.tenant_notification_recipients (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null,
  label text,
  notify_card_payment boolean not null default true,
  notify_order_stock_conflict boolean not null default false,
  notify_external_payment_pending boolean not null default true,
  notify_event_booking_closed_reports boolean not null default true,
  notify_daily_digest boolean not null default false,
  notify_service_inquiries boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
alter table public.tenant_notification_recipients enable row level security;
grant select, insert, update, delete on public.tenant_notification_recipients to service_role;

insert into public.tenants (id, slug, name) values
  ('11111111-1111-4111-8111-111111111111', 'chloefood', 'Chloe Food'),
  ('22222222-2222-4222-8222-222222222222', 'other', 'Other');

insert into public.admin_users (id, email, tenant_id, active) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active@chloe.test', '11111111-1111-4111-8111-111111111111', true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'off@chloe.test', '11111111-1111-4111-8111-111111111111', false),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'left@chloe.test', '11111111-1111-4111-8111-111111111111', true);

insert into public.admin_memberships (user_id, tenant_id, active) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', false);

insert into public.tenant_notification_recipients
  (id, tenant_id, email, notify_card_payment, notify_order_stock_conflict, notify_external_payment_pending,
   notify_event_booking_closed_reports, notify_daily_digest, notify_service_inquiries, active, created_at)
values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'owner@chloe.test',
   true, true, true, true, true, true, true, '2026-01-01'),
  ('d0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'cashier@chloe.test',
   false, false, true, false, false, false, true, '2026-01-02'),
  ('d0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'paused@chloe.test',
   true, false, false, false, false, false, false, '2026-01-03'),
  ('d0000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'other@other.test',
   true, false, false, false, true, false, true, '2026-01-04');
