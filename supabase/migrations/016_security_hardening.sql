-- ─── MIGRATION 016: SECURITY HARDENING ────────────────────────────────────────
-- 1. Rimuove le policy RLS che permettevano insert anonimi su orders/order_items.
--    Tutti gli insert legittimi passano dal service role (API routes + webhook),
--    che bypassa RLS: le policy aperte esponevano il DB a insert arbitrari
--    tramite la anon key pubblica.
-- 2. Indice unico su orders.stripe_payment_intent_id: rende l'idempotenza del
--    webhook Stripe atomica (due retry concorrenti non possono più creare
--    ordini duplicati — il secondo insert fallisce con unique_violation).

DROP POLICY IF EXISTS "orders_insert_any"      ON orders;
DROP POLICY IF EXISTS "order_items_insert_any" ON order_items;

-- Parziale: consente più righe NULL (ordini in_store senza PaymentIntent).
CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_payment_intent_id_uniq
  ON orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;
