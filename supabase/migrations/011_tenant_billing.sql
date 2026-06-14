-- ─── MIGRATION 011: BILLING STATUS PER TENANT ─────────────────────────────────
-- Aggiunge colonne di fatturazione alla tabella tenants.
-- Modello: pagamento manuale mensile via Stripe Payment Link.
-- Nessuna subscription automatica — il tenant paga ogni mese tramite link.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS subscription_status TEXT
    NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('active', 'expired')),
  ADD COLUMN IF NOT EXISTS subscription_paid_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_payment_link TEXT;

COMMENT ON COLUMN tenants.subscription_status IS
  'Stato abbonamento SaaS: active = pagato e attivo | expired = scaduto/non rinnovato';

COMMENT ON COLUMN tenants.subscription_paid_until IS
  'Data fino alla quale l''abbonamento è coperto. Aggiornata dal webhook checkout.session.completed.';

COMMENT ON COLUMN tenants.stripe_payment_link IS
  'URL Stripe Payment Link per il rinnovo mensile (89€). Inserito manualmente da Lepefy Labs.';

-- Nessun GRANT aggiuntivo necessario: tenants è già leggibile dal service_role.
-- Il pannello admin usa createServiceClient() che bypassa RLS.

-- Seed ChloeFood — abbonamento attivo, scade fine luglio 2026
UPDATE tenants
SET
  subscription_status    = 'active',
  subscription_paid_until = '2026-07-14T23:59:59Z',
  stripe_payment_link    = NULL  -- inserire l'URL del Payment Link Stripe reale
WHERE slug = 'chloefood';
