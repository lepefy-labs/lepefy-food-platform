-- MIGRATION 085: DYNAMIC ADMIN RBAC + ADMIN PROFILE
-- Additive, progressive migration. Legacy admin_users.role/tenant_id remain as a compatibility mirror.

alter table public.admin_users
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists nickname text,
  add column if not exists phone text,
  add column if not exists profile_completed_at timestamptz;

-- Existing role constraints only knew the original hard-coded role enum.
-- Keep role as a compatibility mirror but allow dynamic tenant role codes.
alter table public.admin_users drop constraint if exists admin_users_role_check;
alter table public.admin_users drop constraint if exists tenant_admin_requires_tenant;

create table if not exists public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  name text not null,
  description text,
  scope text not null check (scope in ('tenant', 'platform')),
  is_system boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_permissions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'),
  module text not null,
  label text not null,
  description text,
  risk_level text not null default 'standard' check (risk_level in ('standard', 'sensitive', 'critical')),
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_key text not null references public.admin_permissions(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_key)
);

create table if not exists public.admin_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  role_id uuid not null references public.admin_roles(id),
  active boolean not null default true,
  assigned_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_admin_memberships_user_tenant_unique
  on public.admin_memberships(user_id, coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists idx_admin_memberships_tenant on public.admin_memberships(tenant_id) where active;
create index if not exists idx_admin_memberships_role on public.admin_memberships(role_id) where active;

create table if not exists public.admin_access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.admin_users(id),
  tenant_id uuid references public.tenants(id),
  action text not null,
  target_type text not null,
  target_id text,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_admin_access_audit_created on public.admin_access_audit(created_at desc);
create index if not exists idx_admin_access_audit_tenant on public.admin_access_audit(tenant_id, created_at desc);

alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.admin_access_audit enable row level security;

grant select, insert, update, delete on public.admin_roles to service_role;
grant select, insert, update, delete on public.admin_permissions to service_role;
grant select, insert, update, delete on public.admin_role_permissions to service_role;
grant select, insert, update, delete on public.admin_memberships to service_role;
grant select, insert on public.admin_access_audit to service_role;

insert into public.admin_permissions (key, module, label, description, risk_level, position) values
  ('orders.view', 'Boutique · Commandes', 'Voir les commandes', 'Accéder aux commandes et à leur détail.', 'standard', 10),
  ('orders.manage', 'Boutique · Commandes', 'Gérer les commandes', 'Faire évoluer le traitement et le fulfillment des commandes.', 'sensitive', 20),
  ('catalog.view', 'Boutique · Catalogue', 'Voir le catalogue', 'Accéder au catalogue administrateur.', 'standard', 30),
  ('catalog.manage', 'Boutique · Catalogue', 'Gérer le catalogue', 'Créer et modifier produits, catégories et contenu catalogue.', 'sensitive', 40),
  ('shipping.view', 'Boutique · Livraison', 'Voir la livraison', 'Accéder aux opérations logistiques.', 'standard', 50),
  ('loyalty.manage', 'Boutique · Fidélité', 'Gérer la fidélité', 'Accéder aux règles et opérations de fidélité.', 'sensitive', 60),
  ('loyalty.scan', 'Boutique · Fidélité', 'Scanner la fidélité', 'Utiliser le poste de scan fidélité.', 'standard', 70),
  ('growth.manage', 'Boutique · Croissance', 'Gérer la croissance', 'Accéder aux ambassadeurs et fonctions de croissance.', 'standard', 80),
  ('ai_knowledge.manage', 'Boutique · IA', 'Gérer la base IA', 'Gérer la base de connaissance IA du tenant.', 'sensitive', 90),
  ('events.view', 'Événementiel · Événements', 'Voir les événements', 'Accéder aux événements.', 'standard', 110),
  ('events.manage', 'Événementiel · Événements', 'Gérer les événements', 'Créer, modifier et publier les événements.', 'sensitive', 120),
  ('event_reservations.view', 'Événementiel · Réservations', 'Voir les réservations', 'Consulter réservations et demandes.', 'standard', 130),
  ('event_reservations.manage', 'Événementiel · Réservations', 'Gérer les réservations', 'Modifier les opérations de réservation.', 'sensitive', 140),
  ('event_payments.view', 'Événementiel · Paiements', 'Voir les paiements', 'Consulter les paiements externes à vérifier.', 'sensitive', 150),
  ('event_payments.confirm', 'Événementiel · Paiements', 'Confirmer les paiements', 'Confirmer manuellement la réception d’un paiement externe.', 'critical', 160),
  ('event_payments.cancel', 'Événementiel · Paiements', 'Annuler une demande', 'Annuler une demande de paiement externe.', 'critical', 170),
  ('event_content.manage', 'Événementiel · Contenu', 'Gérer le contenu', 'Gérer galerie, services et contenu événementiel.', 'standard', 180),
  ('scan.access', 'Service repas', 'Accéder au scanner', 'Ouvrir le poste Service repas.', 'standard', 200),
  ('scan.search', 'Service repas', 'Rechercher une réservation', 'Rechercher une réservation sans QR.', 'standard', 210),
  ('scan.redeem', 'Service repas', 'Servir les formules', 'Valider la remise des formules.', 'sensitive', 220),
  ('scan.metrics', 'Service repas', 'Voir les indicateurs', 'Voir les KPI du service repas.', 'standard', 230),
  ('scan.undo_own', 'Service repas', 'Annuler sa propre validation', 'Annuler sa propre validation dans la fenêtre autorisée.', 'sensitive', 240),
  ('scan.undo_any', 'Service repas', 'Annuler toute validation', 'Override d’annulation avec motif obligatoire.', 'critical', 250),
  ('tenant_settings.view', 'Administration tenant', 'Voir les paramètres', 'Consulter les paramètres du tenant.', 'standard', 300),
  ('tenant_settings.manage', 'Administration tenant', 'Modifier les paramètres', 'Modifier les paramètres du tenant.', 'sensitive', 310),
  ('billing.view', 'Administration tenant', 'Voir l’abonnement', 'Consulter le plan et l’abonnement.', 'standard', 320),
  ('ai_usage.view', 'Administration tenant', 'Voir l’utilisation IA', 'Consulter l’utilisation IA produit du tenant.', 'standard', 330),
  ('platform.access', 'Plateforme', 'Accéder à la console plateforme', 'Accès à la console interne Lepefy.', 'critical', 900),
  ('platform.users.manage', 'Plateforme', 'Gérer les utilisateurs', 'Gérer les comptes administrateurs et leurs memberships.', 'critical', 910),
  ('platform.roles.manage', 'Plateforme', 'Gérer les rôles et permissions', 'Créer et modifier les rôles tenant.', 'critical', 920),
  ('platform.ai_costs.view', 'Plateforme', 'Voir les coûts IA', 'Consulter les coûts techniques IA.', 'sensitive', 930),
  ('platform.notifications.test', 'Plateforme', 'Tester les notifications', 'Utiliser les outils de test notification.', 'sensitive', 940)
on conflict (key) do update set
  module = excluded.module,
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  position = excluded.position,
  active = true;

insert into public.admin_roles (code, name, description, scope, is_system, active)
values
  ('platform_owner', 'Propriétaire plateforme', 'Accès global Lepefy. Rôle système protégé.', 'platform', true, true),
  ('tenant_admin', 'Administrateur tenant', 'Accès complet à l’administration du tenant.', 'tenant', true, true),
  ('tenant_cashier', 'Caissier', 'Opérations de caisse et scan autorisées.', 'tenant', true, true),
  ('admin_scanner', 'Service repas', 'Accès uniquement au poste Service repas.', 'tenant', true, true)
on conflict (code) do update set name = excluded.name, description = excluded.description, active = true;

-- Platform owner receives all permissions. Tenant admin receives all tenant permissions.
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r cross join public.admin_permissions p
where r.code = 'platform_owner'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r cross join public.admin_permissions p
where r.code = 'tenant_admin' and p.key not like 'platform.%'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r join public.admin_permissions p on p.key in (
  'loyalty.scan','scan.access','scan.search','scan.redeem','scan.metrics','scan.undo_own'
)
where r.code = 'tenant_cashier'
on conflict do nothing;

insert into public.admin_role_permissions (role_id, permission_key)
select r.id, p.key from public.admin_roles r join public.admin_permissions p on p.key in (
  'scan.access','scan.search','scan.redeem','scan.metrics','scan.undo_own'
)
where r.code = 'admin_scanner'
on conflict do nothing;

-- Backfill one membership per current admin. Existing platform_owner remains global.
insert into public.admin_memberships (user_id, tenant_id, role_id, active)
select au.id,
       case when au.role = 'platform_owner' then null else au.tenant_id end,
       r.id,
       au.active
from public.admin_users au
join public.admin_roles r on r.code = au.role
on conflict do nothing;

comment on table public.admin_permissions is 'Stable capability catalog enforced by application code. Roles are dynamically composed from this catalog.';
comment on table public.admin_roles is 'Dynamic RBAC roles. platform_owner is a protected system role; tenant roles can be configured by Platform Owner.';
comment on table public.admin_memberships is 'Assigns an admin user to a role in a tenant or at platform scope. Supports future multi-tenant users.';
comment on column public.admin_users.role is 'Compatibility mirror during progressive RBAC migration. Do not use as the long-term authorization source.';
