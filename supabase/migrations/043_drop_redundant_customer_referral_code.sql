-- ============================================================
-- 043_drop_redundant_customer_referral_code.sql
-- Rimuove customers.referral_code: colonna ridondante, mai scritta
-- ============================================================
--
-- 040_loyalty_referral_system.sql definiva customers.referral_code (+ relativo
-- indice unico) ma nessun endpoint applicativo l'ha mai scritta o letta: il
-- codice referral reale vive in referral_codes.code (owner_customer_id,
-- is_active, max_uses, uses_count), la tabella usata da generateReferralCode,
-- registerWithReferral e /invite/[code]/route.ts. Verificato via grep su
-- apps/storefront/src: le uniche occorrenze di "referral_code" sono
-- riferimenti a referral_codes.code o al cookie 'referral_code' impostato da
-- /invite/[code] — nessun uso reale della colonna su customers.

alter table customers drop column if exists referral_code;
drop index if exists idx_customers_referral_code;
