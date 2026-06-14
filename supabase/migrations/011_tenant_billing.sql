-- ─── MIGRATION 011: BILLING STATUS PER TENANT ─────────────────────────────────
-- Aggiunge colonne di fatturazione alla tabella tenants.
-- Modello: pagamento manuale mensile, due opzioni: Stripe Payment Link o bonifico.
-- Nessuna subscription automatica — il tenant paga ogni mese tramite il metodo preferito.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_status TEXT
    NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('active', 'expired')),
  ADD COLUMN IF NOT EXISTS subscription_paid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_payment_link TEXT,
  ADD COLUMN IF NOT EXISTS bank_iban TEXT,
  ADD COLUMN IF NOT EXISTS bank_beneficiary TEXT,
  ADD COLUMN IF NOT EXISTS bank_bic TEXT;

COMMENT ON COLUMN tenants.subscription_status IS
  'Stato abbonamento SaaS: active = pagato e attivo | expired = scaduto/non rinnovato';

COMMENT ON COLUMN tenants.subscription_paid_until IS
  'Data fino alla quale l''abbonamento è coperto. '
  'Aggiornata automaticamente dal webhook Stripe o manualmente da Lepefy Labs dopo bonifico.';

COMMENT ON COLUMN tenants.stripe_payment_link IS
  'URL Stripe Payment Link per il rinnovo mensile (89€). '
  'Commissione ~1,59€ a carico di Lepefy Labs. Inserito manualmente da Lepefy Labs.';

COMMENT ON COLUMN tenants.bank_iban IS
  'IBAN per bonifico bancario mensile. Zero commissioni. Aggiornamento DB manuale dopo accredito.';

COMMENT ON COLUMN tenants.bank_beneficiary IS
  'Intestatario del conto bancario (es. "Robertin Xxx — Lepefy Labs").';

COMMENT ON COLUMN tenants.bank_bic IS
  'BIC/SWIFT della banca per bonifici internazionali.';

-- Nessun GRANT aggiuntivo necessario: tenants è già leggibile dal service_role.
-- Il pannello admin usa createServiceClient() che bypassa RLS.

-- Seed ChloeFood — abbonamento attivo, scade fine luglio 2026
UPDATE tenants
SET
  subscription_status     = 'active',
  subscription_paid_until = '2026-07-14T23:59:59Z',
  stripe_payment_link     = NULL,   -- inserire URL Payment Link Stripe reale
  bank_iban               = NULL,   -- inserire IBAN reale (es. 'IT60 X054 2811 1010 0000 0123 456')
  bank_beneficiary        = NULL,   -- inserire intestatario reale (es. 'Mario Rossi - Lepefy Labs')
  bank_bic                = NULL    -- inserire BIC reale (es. 'BLOPIT22')
WHERE slug = 'chloefood';
