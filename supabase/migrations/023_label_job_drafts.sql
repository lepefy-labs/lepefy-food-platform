-- ─── MIGRATION 023: BOZZE E RISTAMPA ETICHETTE ───────────────────────────────
-- (rinominata da 020 → 023: 020/021/022 sono già occupate da migration successive)

alter table label_print_jobs
  add column if not exists status             text not null default 'generated'
                              check (status in ('draft', 'generated')),
  add column if not exists duplicated_from_id  uuid references label_print_jobs(id) on delete set null,
  add column if not exists updated_at          timestamptz not null default now();

-- Righe già esistenti (create dalla prima versione del sistema) sono tutte 'generated' —
-- il default sopra copre la retrocompatibilità senza bisogno di UPDATE esplicito.

-- Rendi opzionali i campi che in fase di bozza potrebbero non essere ancora compilati
alter table label_print_jobs
  alter column lot_number      drop not null,
  alter column durability_date drop not null,
  alter column quantity        drop not null;

-- labels_per_sheet/sheets_generated sono calcolati solo alla generazione del PDF —
-- una bozza appena creata non li ha ancora, quindi devono poter essere null.
alter table label_print_jobs
  alter column labels_per_sheet  drop not null,
  alter column sheets_generated  drop not null;

comment on column label_print_jobs.status is
  'draft = bozza in corso, autosalvata mentre l''admin compila il form. '
  'generated = PDF generato con successo, pdf_url valorizzato, immutabile.';
comment on column label_print_jobs.duplicated_from_id is
  'Se il job è nato da "Duplica per ristampa" di un job precedente, punta a quello. '
  'Solo per tracciabilità, nessuna logica dipende da questo campo.';

grant update on public.label_print_jobs to service_role;

-- drop+create invece di CREATE OR REPLACE TRIGGER per compatibilità con Postgres < 14
drop trigger if exists label_print_jobs_updated_at on label_print_jobs;
create trigger label_print_jobs_updated_at before update on label_print_jobs
  for each row execute function update_updated_at();

create index if not exists idx_label_print_jobs_status on label_print_jobs(tenant_id, product_id, status, updated_at desc);
