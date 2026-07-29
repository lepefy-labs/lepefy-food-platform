-- ============================================================
-- 041_fix_points_balance_view.sql
-- Fix mirato 1/3: customer_points_balance non nettava gli storni
-- ============================================================
--
-- Bug: uno storno (REVERSED) non riduceva confirmed_balance, perché sia la
-- riga originale (resta CONFIRMED, reverseOrderPoints non la tocca mai —
-- append-only) sia la riga di storno (status REVERSED) erano escluse dai
-- filtri della view. Un cliente rimborsato manteneva i punti.
--
-- Fix: la riga REVERSED ha amount di segno opposto e stesso valore assoluto
-- dell'originale (garantito da reverseOrderPoints.ts, non toccato qui) —
-- sommandola nello stesso filtro di CONFIRMED, il netto torna a zero senza
-- mai fare UPDATE sulla riga originale — resta append-only.
--
-- Verificato con un test concreto contro Postgres reale (non solo sulla
-- carta): 100 pt CONFIRMED + storno -100 REVERSED → view vecchia dà 100
-- (bug), view nuova dà 0 (corretto). Vedi report finale per l'output.

create or replace view customer_points_balance as
select
  tenant_id, customer_id,
  coalesce(sum(amount) filter (where status in ('CONFIRMED', 'REVERSED')), 0) as confirmed_balance,
  coalesce(sum(amount) filter (where status = 'PENDING'), 0) as pending_balance
from points_ledger
group by tenant_id, customer_id;
