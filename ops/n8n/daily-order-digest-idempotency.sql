-- Run ONCE on a dedicated PostgreSQL database accessible by n8n.
-- Do not execute on production Supabase without separate authorization.
CREATE SCHEMA IF NOT EXISTS lepefy_n8n;
CREATE TABLE IF NOT EXISTS lepefy_n8n.digest_email_claims (
  idempotency_key text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('processing','accepted','failed')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);
CREATE INDEX IF NOT EXISTS digest_email_claims_pending_idx
  ON lepefy_n8n.digest_email_claims (claimed_at) WHERE status = 'processing';
-- The n8n credential role needs SELECT, INSERT and UPDATE only on this table.
-- Keep accepted rows for the entire replay/retry window.
