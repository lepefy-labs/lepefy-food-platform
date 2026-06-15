-- ─── MIGRATION 011: POWERED BY FLAG ──────────────────────────────────────────
-- Aggiunge show_powered_by a tenants.
-- true  → mostra "Propulsé par Lepefy Labs" nel footer (default)
-- false → white-label completo (opzione premium per tenant futuri)

alter table tenants
  add column if not exists show_powered_by boolean not null default true;

comment on column tenants.show_powered_by is
  'Se true mostra "Propulsé par Lepefy Labs" nel footer storefront. '
  'Default true. Impostare false per tenant white-label (piano premium).';

-- Seed esplicito ChloeFood (già coperto dal default, ma esplicito per chiarezza)
update tenants
set show_powered_by = true
where slug = 'chloefood';
