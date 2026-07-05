-- ─── MIGRATION 017: DIGITAL CARD (whatsapp + social links) ───────────────────
-- Aggiunge il numero WhatsApp al tenant e una tabella di link social
-- configurabile, per alimentare la landing card digitale (/card).

alter table tenants
  add column if not exists whatsapp_number text;

comment on column tenants.whatsapp_number is
  'Numero WhatsApp in formato E.164 senza spazi (es. "393296958822"), usato per i link wa.me su storefront e digital card.';

-- ─── TENANT SOCIAL LINKS ──────────────────────────────────────────────────────
create table if not exists public.tenant_social_links (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  platform    text not null check (platform in (
                'instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'x'
              )),
  url         text not null,
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tenant_id, platform)
);

comment on table public.tenant_social_links is
  'Profili social attivi per tenant, mostrati nella digital card (/card). '
  'Nuove piattaforme si aggiungono estendendo la CHECK constraint e il registro '
  'SOCIAL_PLATFORM_REGISTRY in packages/types — mai nel componente del tenant.';

alter table public.tenant_social_links enable row level security;

create policy "tenant_social_links_select_public"
  on public.tenant_social_links for select
  using (active = true);

-- GRANTs obbligatori (pattern Lepefy: RLS non basta)
grant usage on schema public to anon, authenticated;
grant select on public.tenant_social_links to anon, authenticated;
