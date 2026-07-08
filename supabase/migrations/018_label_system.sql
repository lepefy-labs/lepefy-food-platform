-- ─── MIGRATION 018: SISTEMA ETICHETTE PRODOTTO ───────────────────────────────
-- (numerata 018 anziché 017: la 017 è già occupata da 017_tenant_digital_card.sql)

-- ─── 1. PRODUCERS (produttore reale, "Prodotto da") ──────────────────────────
create table if not exists producers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  legal_address   text not null,
  vat_number      text,
  health_stamp    text,
  country         text not null default 'IT',
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table producers is
  'Produttore effettivo del prodotto ("Prodotto da"), spesso extra-UE. '
  'Un tenant può avere più producers; ogni prodotto ne referenzia uno (opzionale).';

-- ─── 2. IMPORTERS (operatore UE responsabile, "Importato da") ────────────────
create table if not exists importers (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  name            text not null,
  legal_address   text not null,
  vat_number      text,
  email           text,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table importers is
  'Operatore UE responsabile dell''importazione ("Importato da") — OSA ai sensi '
  'Reg. 1169/2011 quando il producer è extra-UE. Entità distinta dal producer.';

alter table producers enable row level security;
alter table importers enable row level security;

create policy "producers_select_public" on producers for select using (active = true);
create policy "importers_select_public" on importers for select using (active = true);

grant usage on schema public to anon, authenticated;
grant select on public.producers to anon, authenticated, service_role;
grant select on public.importers to anon, authenticated, service_role;
grant insert, update, delete on public.producers to service_role;
grant insert, update, delete on public.importers to service_role;

create trigger producers_updated_at before update on producers
  for each row execute function update_updated_at();
create trigger importers_updated_at before update on importers
  for each row execute function update_updated_at();

-- ─── 3. ESTENSIONE PRODUCTS ───────────────────────────────────────────────────
alter table products
  add column if not exists producer_id               uuid references producers(id) on delete set null,
  add column if not exists importer_id                uuid references importers(id) on delete set null,
  add column if not exists ingredients_text           text,
  add column if not exists allergens_text             text,
  add column if not exists gluten_free_certified       boolean not null default false,
  add column if not exists usage_instructions         text,
  add column if not exists conservation_instructions  text,
  add column if not exists conservation_after_opening text,
  add column if not exists country_of_origin          text,
  add column if not exists durability_type            text
                               check (durability_type in ('best_before', 'use_by')),
  add column if not exists quid_ingredient             text,
  add column if not exists quid_percentage             numeric(5,2),
  add column if not exists alcohol_pct                 numeric(4,2),
  add column if not exists net_quantity_display        text,
  add column if not exists packaging_material          text,
  add column if not exists recycling_note              text,
  add column if not exists nutrition_basis             text not null default '100g'
                               check (nutrition_basis in ('100g', '100ml')),
  add column if not exists nutrition                   jsonb,
  add column if not exists label_background_image_url text,
  add column if not exists label_background_color     text;

comment on column products.gluten_free_certified is
  'true solo se il prodotto ha una certificazione/analisi che attesta assenza di glutine. '
  'Default false — non dedurre mai da "l''ingrediente è naturalmente senza glutine".';
comment on column products.durability_type is
  'best_before = TMC "da consumarsi preferibilmente entro" (stabili). '
  'use_by = scadenza "da consumarsi entro" (deperibili).';
comment on column products.net_quantity_display is
  'Testo esatto per la quantità netta in etichetta (es. "1 L"). '
  'Se null, il template formatta weight_grams automaticamente.';
comment on column products.nutrition is
  'jsonb libero: kcal, kj, fat_g, saturated_fat_g, carbs_g, sugars_g, fiber_g, protein_g, salt_g. '
  'Il template legge solo le chiavi presenti.';
comment on column products.label_background_image_url is
  'Override sfondo etichetta per singolo prodotto. Se impostato vince su categories.label_background_image_url.';

-- ─── 4. ESTENSIONE CATEGORIES (sfondo di default) ────────────────────────────
alter table categories
  add column if not exists label_background_image_url text,
  add column if not exists label_background_color      text;

comment on column categories.label_background_image_url is
  'Sfondo di default per tutti i prodotti della categoria, sovrascrivibile per singolo prodotto.';

-- ─── 5. ESTENSIONE TENANTS (logo dedicato + dati legali) ─────────────────────
alter table tenants
  add column if not exists label_logo_url  text,
  add column if not exists legal_name      text,
  add column if not exists legal_address   text,
  add column if not exists legal_email     text,
  add column if not exists legal_website   text;

comment on column tenants.label_logo_url is
  'Logo dedicato alle etichette prodotto — asset distinto da logo_url (sito/PWA). '
  'Obbligatorio per generare etichette: se null, il form blocca la generazione.';

-- Seed dati legali reali ChloeFood (dal file fornito dal cliente, 20260708)
update tenants set
  legal_name      = 'Chloé Food ETS',
  legal_address   = 'Via Angelo Zanti, 1C - 42122 Reggio Emilia (RE), Italia',
  legal_email     = 'chloefood.ets@gmail.com'
where slug = 'chloefood';

-- Seed producer/importer reali ricorrenti nei dati forniti
insert into producers (tenant_id, name, legal_address, country)
select id, 'Africa Food Services', 'Camerun', 'CM' from tenants where slug = 'chloefood'
on conflict do nothing;

insert into importers (tenant_id, name, legal_address, email)
select id,
       'AFRICOOP Società Cooperativa',
       'Via Giovanni Battista Malagoli, 34/a - 41121 Modena (MO), Italia',
       'africoopmodena@gmail.com'
from tenants where slug = 'chloefood'
on conflict do nothing;

-- ─── 6. LABEL_SETTINGS (default formato per tenant) ──────────────────────────
create table if not exists label_settings (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  default_template_key  text not null default 'default',
  sheet_width_mm        int  not null default 210,
  sheet_height_mm       int  not null default 297,
  label_width_mm        int  not null default 100,
  label_height_mm       int  not null default 75,
  margin_mm             int  not null default 5,
  gutter_mm             int  not null default 2,
  crop_marks            boolean not null default true,
  updated_at            timestamptz not null default now(),
  unique(tenant_id)
);

alter table label_settings enable row level security;
create policy "label_settings_select_public" on label_settings for select using (true);
grant select on public.label_settings to anon, authenticated, service_role;
grant insert, update on public.label_settings to service_role;

insert into label_settings (tenant_id)
select id from tenants where slug = 'chloefood'
on conflict (tenant_id) do nothing;

-- ─── 7. LABEL_PRINT_JOBS (storico stampe) ────────────────────────────────────
create table if not exists label_print_jobs (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  product_id          uuid not null references products(id) on delete cascade,
  template_key        text not null default 'default',
  included_sections   jsonb not null default '{}',
  lot_number          text not null,
  production_date     date,
  durability_date     date not null,
  quantity            int  not null,
  sheet_width_mm      int  not null,
  sheet_height_mm     int  not null,
  label_width_mm      int  not null,
  label_height_mm     int  not null,
  labels_per_sheet    int  not null,
  sheets_generated    int  not null,
  pdf_url             text,
  created_by          text,
  created_at          timestamptz not null default now()
);

comment on table label_print_jobs is
  'Storico stampe etichette — permette ristampe rapide e tracciabilità qualità. '
  'lot_number/date NON vivono su products: cambiano a ogni produzione.';

alter table label_print_jobs enable row level security;
create policy "label_print_jobs_service_only" on label_print_jobs for all using (false);
grant select, insert on public.label_print_jobs to service_role;

create index if not exists idx_label_print_jobs_product on label_print_jobs(product_id, created_at desc);
