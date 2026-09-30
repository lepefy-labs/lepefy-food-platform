-- MIGRATION 138: TENANT DI TEST + FEATURE FLAG DI RILASCIO PER TENANT
--
-- 1. tenants.is_test: marca un tenant di test che vive nello stesso progetto
--    Supabase di produzione, isolato come ogni altro tenant via tenant_id + RLS.
--    Colonna PRIVATA: nessun grant di colonna ad anon/authenticated (vedi 076),
--    letta solo lato server (getTenant() usa il service role).
-- 2. tenant_feature_flags: flag di RILASCIO temporanei (una feature nuova nasce
--    con un flag spento, viene accesa prima sul tenant di test, poi sugli
--    altri, poi il flag viene rimosso dal codice). Distinti da
--    tenant_feature_settings (096), che resta per i moduli permanenti con
--    config e FK sul catalogo commerciale platform_features.
--    Riga assente = flag spento.
-- 3. Ordini e prenotazioni evento di un tenant di test sono sempre is_test = true
--    (trigger BEFORE INSERT: copre checkout, webhook, RPC di conversione e
--    qualsiasi percorso futuro senza toccare la logica di checkout).
-- 4. Inserisce il tenant lepefy-test con branding neutro.
--
-- Additiva e rieseguibile. Non modifica alcun tenant esistente.

begin;

-- ─── 1. tenants.is_test ───────────────────────────────────────────────────────
alter table public.tenants
  add column if not exists is_test boolean not null default false;

comment on column public.tenants.is_test is
  'Tenant di test (es. lepefy-test). Le comunicazioni esterne verso i clienti vengono '
  'deviate o saltate (lib/tenant/testTenant.ts) e i suoi ordini/prenotazioni sono is_test = true. '
  'Privata: mai esposta al browser.';

-- ─── 2. tenant_feature_flags ─────────────────────────────────────────────────
create table if not exists public.tenant_feature_flags (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  flag_key   text not null,
  enabled    boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (tenant_id, flag_key),
  constraint tenant_feature_flags_key_format check (flag_key ~ '^[a-z][a-z0-9_]{1,63}$')
);

comment on table public.tenant_feature_flags is
  'Flag di rilascio per tenant (temporanei). Riga assente = spento. '
  'Letti da isFeatureEnabled() (lib/featureFlags/featureFlags.ts); scritti solo dal service role.';

-- Tenant dell''utente autenticato: admin attivo del tenant o cliente del tenant.
-- security definer perché admin_users non ha policy pubbliche (solo service role).
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select a.tenant_id
  from public.admin_users a
  where a.id = auth.uid() and a.active and a.tenant_id is not null
  union
  select c.tenant_id
  from public.customers c
  where c.auth_user_id = auth.uid() and c.tenant_id is not null
$$;

revoke all on function public.current_user_tenant_ids() from public, anon;
grant execute on function public.current_user_tenant_ids() to authenticated, service_role;

alter table public.tenant_feature_flags enable row level security;

revoke all on table public.tenant_feature_flags from public, anon, authenticated;
grant select on table public.tenant_feature_flags to authenticated;
grant select, insert, update, delete on table public.tenant_feature_flags to service_role;

-- Lettura: solo i flag del proprio tenant. Nessuna policy di scrittura:
-- insert/update/delete solo via service role (che bypassa RLS).
drop policy if exists tenant_feature_flags_select_own_tenant on public.tenant_feature_flags;
create policy tenant_feature_flags_select_own_tenant
  on public.tenant_feature_flags
  for select
  to authenticated
  using (tenant_id in (select public.current_user_tenant_ids()));

-- ─── 3. is_test forzato per i tenant di test ──────────────────────────────────
create or replace function public.mark_test_tenant_rows()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not coalesce(new.is_test, false)
     and exists (select 1 from public.tenants t where t.id = new.tenant_id and t.is_test) then
    new.is_test := true;
  end if;
  return new;
end;
$$;

revoke all on function public.mark_test_tenant_rows() from public, anon, authenticated;

drop trigger if exists orders_mark_test_tenant on public.orders;
create trigger orders_mark_test_tenant
  before insert on public.orders
  for each row execute function public.mark_test_tenant_rows();

drop trigger if exists event_reservations_mark_test_tenant on public.event_reservations;
create trigger event_reservations_mark_test_tenant
  before insert on public.event_reservations
  for each row execute function public.mark_test_tenant_rows();

-- ─── 4. Tenant lepefy-test ───────────────────────────────────────────────────
-- Branding volutamente neutro (grigi, nessun logo) e diverso da ogni tenant
-- reale: un valore hardcoded altrove salta subito all'occhio.
-- Spedizione a tariffa fissa: nessuna chiamata Packlink necessaria.
insert into public.tenants (
  slug, name, tagline, logo_url,
  primary_color, secondary_color, accent_light,
  country, currency, locale,
  storefront_url, shipping_provider, flat_rate_amount,
  active, is_test
)
values (
  'lepefy-test', 'Lepefy Test', 'Boutique de test', null,
  '#4B5563', '#9CA3AF', '#F3F4F6',
  'IT', 'EUR', 'fr-FR',
  'https://test.lepefy.com', 'flat_rate', 5.90,
  true, true
)
on conflict (slug) do nothing;

commit;
