-- ─── MIGRATION 126: APPLE PAY — DIGITAL CARD (/card) ─────────────────────────
-- Nouveau moyen de paiement `apple_pay` pour tenant_payment_methods : active
-- la tuile « Apple Pay » dans /card (flux dédié : montant, puis un seul
-- bouton Apple Pay via Stripe Express Checkout Element). Simple on/off comme
-- `card` : jamais de value/extra. Indépendant de la ligne `card` : la tuile
-- s'affiche si une ligne `apple_pay` active contient 'card' dans
-- enabled_modules ET si l'appareil supporte Apple Pay (détection côté client).
-- Le paiement réutilise tel quel api/card/quick-pay, le PaymentIntent et le
-- webhook `card_quick_payment` : aucun changement côté paiement.
--
-- Étend la CHECK constraint (dernière version : 062_tenant_card_payments.sql)
-- pour accepter 'apple_pay'. Idempotent, aucune donnée modifiée.
--
-- GRANT : aucune nouvelle table ni colonne, donc aucun nouveau GRANT
-- nécessaire ; ceux de 030_tenant_payment_methods.sql restent en vigueur.

alter table public.tenant_payment_methods
  drop constraint if exists tenant_payment_methods_method_check;
alter table public.tenant_payment_methods
  add constraint tenant_payment_methods_method_check
  check (method in ('satispay','bank_transfer','cash','paypal','other','card','apple_pay'));

-- Rollback (seulement si aucune ligne apple_pay n'existe) :
-- delete from public.tenant_payment_methods where method = 'apple_pay';
-- alter table public.tenant_payment_methods drop constraint if exists tenant_payment_methods_method_check;
-- alter table public.tenant_payment_methods add constraint tenant_payment_methods_method_check
--   check (method in ('satispay','bank_transfer','cash','paypal','other','card'));
