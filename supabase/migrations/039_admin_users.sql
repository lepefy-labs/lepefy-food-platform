-- ============================================================
-- 039_admin_users.sql
-- ============================================================

create table if not exists admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('platform_owner', 'tenant_admin')),
  tenant_id uuid references tenants(id),
  active boolean not null default true,
  invited_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  constraint tenant_admin_requires_tenant check (
    (role = 'tenant_admin' and tenant_id is not null) or
    (role = 'platform_owner' and tenant_id is null)
  )
);

create unique index if not exists idx_admin_users_email on admin_users(lower(email));
create index if not exists idx_admin_users_tenant on admin_users(tenant_id) where role = 'tenant_admin';

alter table admin_users enable row level security;
-- Nessuna policy pubblica: solo service_role tocca questa tabella, mai esposta
-- via client anon/authenticated — è la tabella dei permessi stessa.
grant select, insert, update on admin_users to service_role;

comment on table admin_users is
  'Sostituisce la whitelist flat ADMIN_EMAILS. platform_owner: tenant_id NULL, accesso globale. tenant_admin: tenant_id obbligatorio, scoped.';
