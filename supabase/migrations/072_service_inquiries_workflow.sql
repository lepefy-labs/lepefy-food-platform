-- ─── 072: SERVICE INQUIRIES OPERATIONAL WORKFLOW ────────────────────────────
-- Extends the existing lightweight Event inquiry workflow without introducing
-- CRM activity tables, assignments or quote-generation objects.

alter table service_inquiries
  drop constraint if exists service_inquiries_status_check;

alter table service_inquiries
  add constraint service_inquiries_status_check
  check (status in ('nouveau','a_contacter','contacte','devis_envoye','accepte','refuse','clos'));

alter table service_inquiries
  add column if not exists internal_notes text,
  add column if not exists contacted_at timestamptz,
  add column if not exists quote_sent_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists service_inquiries_updated_at on service_inquiries;
create trigger service_inquiries_updated_at
  before update on service_inquiries
  for each row execute function update_updated_at();
