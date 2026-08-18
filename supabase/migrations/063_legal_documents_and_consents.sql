-- ─── MIGRATION 063: GESTION DES CONSENTEMENTS (CGV, MARKETING, COOKIES) ────────
-- Ciclo 1/6 — schéma DB uniquement, aucune UI touchée.
-- tenant_legal_documents : versionnement des documents légaux par tenant
-- (aujourd'hui uniquement 'terms' — la Politique de confidentialité reste
-- statique pour l'instant, mais la structure doit pouvoir l'accueillir plus
-- tard sans migration supplémentaire, d'où le CHECK ouvert à 'privacy').
-- user_consents : piste d'audit immuable de chaque consentement recueilli.

-- ─── TENANT_LEGAL_DOCUMENTS ─────────────────────────────────────────────────
create table if not exists public.tenant_legal_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  doc_type        text not null check (doc_type in ('terms', 'privacy')),
  version         integer not null,
  content         text not null,
  effective_date  timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (tenant_id, doc_type, version)
);

create index idx_tenant_legal_documents_current
  on public.tenant_legal_documents (tenant_id, doc_type, version desc);

comment on table public.tenant_legal_documents is
  'Versionnement des documents légaux par tenant. Seul doc_type=''terms'' est utilisé '
  'en Ciclo 1 — ''privacy'' est prévu pour un usage futur, la Politique de confidentialité '
  'restant statique (voir apps/storefront/.../politique-confidentialite/page.tsx) pour l''instant.';

-- ─── USER_CONSENTS ───────────────────────────────────────────────────────────
create table if not exists public.user_consents (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  user_id        uuid references public.customers(id) on delete cascade,
  order_id       uuid references public.orders(id) on delete cascade,
  consent_type   text not null check (consent_type in ('terms', 'marketing', 'cookies_analytics', 'cookies_marketing')),
  doc_version    integer,
  granted        boolean not null,
  source         text not null check (source in ('signup', 'checkout', 'reconsent_gate', 'cookie_banner', 'account_settings')),
  ip_address     text,
  user_agent     text,
  created_at     timestamptz not null default now(),
  constraint user_consents_anchor_check check (user_id is not null or order_id is not null)
);

create index idx_user_consents_lookup
  on public.user_consents (tenant_id, user_id, consent_type, created_at desc);

create index idx_user_consents_order
  on public.user_consents (order_id)
  where order_id is not null;

comment on table public.user_consents is
  'Piste d''audit immuable de chaque consentement recueilli (CGV, marketing, cookies). '
  'Aucun UPDATE/DELETE côté client — une correction se fait via une nouvelle ligne.';

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table public.tenant_legal_documents enable row level security;
alter table public.user_consents enable row level security;

-- tenant_legal_documents : lecture publique (le contenu des CGV doit être
-- lisible par tout visiteur, même non authentifié), écriture réservée au
-- service_role (publication d'une nouvelle version = action admin/backend).
create policy "tenant_legal_documents_select_public"
  on public.tenant_legal_documents for select
  using (true);

-- user_consents : aucune lecture publique libre. Un utilisateur authentifié
-- ne lit que ses propres lignes. INSERT permis à authenticated (ses propres
-- consentements) et à service_role (consentements guest côté serveur).
-- Aucun UPDATE/DELETE côté client — record immuable.
create policy "user_consents_select_own"
  on public.user_consents for select
  using (user_id = auth.uid());

create policy "user_consents_insert_own"
  on public.user_consents for insert
  with check (user_id = auth.uid());

-- ─── GRANTS ───────────────────────────────────────────────────────────────────
grant usage on schema public to anon, authenticated;

grant select on public.tenant_legal_documents to anon, authenticated, service_role;
grant insert, update on public.tenant_legal_documents to service_role;

grant select, insert on public.user_consents to authenticated;
grant select, insert on public.user_consents to service_role;
