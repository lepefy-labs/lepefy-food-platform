-- ─── MIGRATION 045: HERO SLIDES (multi-slide home hero) ───────────────────────
-- Sostituisce l'hero fisso della home con più slide gestibili da /admin
-- (cycle "redesign home" — Feature 1 + Feature 5). Fallback obbligatorio a
-- runtime se questa tabella è vuota per un tenant: lo storefront costruisce
-- una slide unica da tenant.tagline — l'hero non deve mai sparire.

create table if not exists public.tenant_hero_slides (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  position              int not null default 0,
  badge_text            text,
  title                 text not null,
  subtitle              text,
  cta_primary_label     text,
  cta_primary_url       text,
  cta_secondary_label   text,
  cta_secondary_url     text,
  background_variant    text not null default 'primary'
                          check (background_variant in ('primary', 'secondary', 'accent')),
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists tenant_hero_slides_tenant_position_idx
  on public.tenant_hero_slides (tenant_id, position)
  where active;

comment on table public.tenant_hero_slides is
  'Slide de l''hero carousel de la home, gérées via /admin/accueil-slides. '
  'background_variant mappe vers des gradients dérivés des tokens CSS du tenant '
  '(--color-primary / --color-secondary), jamais des hex fixes — voir '
  'src/components/home/HeroCarousel.tsx pour le mapping exact.';

alter table public.tenant_hero_slides enable row level security;

-- Lettura pubblica solo per le slide attive — la query applicativa filtra
-- comunque sempre per tenant_id (mai fidarsi della sola RLS lato client),
-- stesso pattern di tenant_social_links / tenant_payment_methods.
create policy "tenant_hero_slides_select_public"
  on public.tenant_hero_slides for select
  using (active = true);

-- GRANTs obbligatori (pattern Lepefy: RLS non basta) — scrittura riservata
-- al service client usato dalle route /api/admin/hero-slides.
grant usage on schema public to anon, authenticated;
grant select on public.tenant_hero_slides to anon, authenticated;
grant insert, update, delete on public.tenant_hero_slides to service_role;
