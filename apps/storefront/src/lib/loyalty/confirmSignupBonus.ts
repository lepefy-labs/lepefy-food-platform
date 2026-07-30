import { createServiceClient } from '@/lib/supabase/server';

/**
 * UPDATE della riga SIGNUP_BONUS esistente (PENDING→CONFIRMED) per un
 * customer. Unico punto di verità per questa transizione — chiamato sia da
 * processOrderPointsOnDelivery (automatico, gated dal controllo "primo ordine
 * consegnato") sia dall'azione admin manuale "Confirmer" nel pannello "bonus
 * de bienvenue en attente" (senza quel gate, è una conferma manuale
 * deliberata). Nessuna logica duplicata tra i due punti di chiamata.
 *
 * Propaga qualunque errore Supabase — il chiamante decide cosa farne
 * (processOrderPointsOnDelivery la fa bloccare l'intero hook, vedi Fix A).
 */
export async function confirmSignupBonus(tenantId: string, customerId: string): Promise<void> {
  const supabase = createServiceClient();

  const { error } = await supabase
    .from('points_ledger')
    .update({ status: 'CONFIRMED' })
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('transaction_type', 'SIGNUP_BONUS')
    .eq('status', 'PENDING');

  if (error) throw error;
}
