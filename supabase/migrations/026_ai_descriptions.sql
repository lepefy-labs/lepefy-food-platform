-- 026_ai_descriptions.sql
-- Descrizioni prodotto multilingue + configurazione lingue tenant

-- 1. Colonne prodotto
alter table public.products
  add column if not exists descriptions jsonb not null default '{}'::jsonb,
  add column if not exists description_source text
    check (description_source in ('ai', 'human'));

comment on column public.products.descriptions is
  'Descrizioni per locale, es. {"fr": "...", "it": "..."}. Le chiavi valide sono definite da tenants.locales.';
comment on column public.products.description_source is
  'ai = generata da AI (da rivedere), human = scritta/validata da umano, null = nessuna descrizione strutturata.';

-- 2. Configurazione tenant
alter table public.tenants
  add column if not exists locales text[] not null default array['fr'],
  add column if not exists ai_description_generation boolean not null default false;

comment on column public.tenants.locales is
  'Lingue attive del tenant. La prima è il locale di default dello storefront.';

-- 3. Attivazione per ChloeFood
update public.tenants
set locales = array['fr','it'],
    ai_description_generation = true
where slug = 'chloefood';

-- 4. Backfill: migra la vecchia colonna description nel locale di default
update public.products p
set descriptions = jsonb_build_object(
      (select t.locales[1] from public.tenants t where t.id = p.tenant_id),
      p.description
    ),
    description_source = 'human'
where p.description is not null
  and btrim(p.description) <> ''
  and p.descriptions = '{}'::jsonb;

-- 5. Grants espliciti (Supabase richiede GRANT oltre alle policy RLS)
grant select on public.products to anon;
grant select on public.tenants to anon;
grant select, update on public.products to service_role;
grant select on public.tenants to service_role;
