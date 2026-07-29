import { createServiceClient } from '@/lib/supabase/server';

/**
 * Aggiunta non richiesta esplicitamente dal prompt ma necessaria (annullamento
 * / rimborso ordine dopo che i punti sono già stati processati) — segnalata
 * come proposta nel report finale.
 *
 * Implementazione letterale della spec: SOLO insert di righe speculari,
 * mai update delle righe originali (points_ledger è append-only). Un unico
 * `.insert(array)` produce un solo statement INSERT multi-riga — atomico per
 * costruzione, senza bisogno di una funzione RPC dedicata.
 *
 * ATTENZIONE (segnalato nel report): la view customer_points_balance filtra
 * per status = 'CONFIRMED' / 'PENDING'. Poiché questa funzione non tocca lo
 * status della riga originale (resta CONFIRMED o PENDING), uno storno di una
 * riga CONFIRMED non riduce oggi confirmed_balance — la riga REVERSED
 * inserita qui è esclusa da entrambe le somme quanto l'originale che dovrebbe
 * annullare. Serve una decisione di prodotto: o la view cambia per sottrarre
 * gli storni collegati, oppure reverseOrderPoints deve anche marcare
 * l'originale REVERSED (in tensione con "mai UPDATE, append-only").
 */
export async function reverseOrderPoints(orderId: string): Promise<void> {
  const supabase = createServiceClient();

  const { data: rows } = await supabase
    .from('points_ledger')
    .select('id, tenant_id, customer_id, amount, reference_order_id, reference_customer_id')
    .eq('reference_order_id', orderId)
    .in('status', ['PENDING', 'CONFIRMED']);

  if (!rows || rows.length === 0) return;

  const reversalRows = rows.map((row) => ({
    tenant_id: row.tenant_id,
    customer_id: row.customer_id,
    amount: -row.amount,
    status: 'REVERSED' as const,
    transaction_type: 'REVERSED' as const,
    reference_order_id: row.reference_order_id,
    reference_customer_id: row.reference_customer_id,
    reversal_of_ledger_id: row.id,
  }));

  const { error } = await supabase.from('points_ledger').insert(reversalRows);
  if (error) throw error;
}
