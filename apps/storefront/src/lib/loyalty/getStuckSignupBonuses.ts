import { createServiceClient } from '@/lib/supabase/server';

// Soglia oltre la quale un SIGNUP_BONUS ancora PENDING è considerato
// "bloccato" e va mostrato nel pannello admin — costante nominata, non un
// magic number sparso nella query (facilmente modificabile qui).
export const STUCK_SIGNUP_BONUS_THRESHOLD_DAYS = 7;

export interface StuckSignupBonus {
  ledgerEntryId: string;
  customerId: string;
  customerEmail: string;
  customerFullName: string | null;
  amount: number;
  createdAt: string;
  /**
   * true = il customer ha già un ordine 'delivered' → il bonus AVREBBE dovuto
   * confermarsi automaticamente e non l'ha fatto (caso anomalo, priorità alta).
   * false = il customer non ha ancora ordinato nulla (caso atteso, sta solo
   * aspettando il suo primo ordine — non un'anomalia).
   */
  hasDeliveredOrder: boolean;
}

/**
 * Usata sia da GET /api/admin/loyalty/stuck-signup-bonuses sia dal fetch
 * iniziale server-side di /admin/loyalty/page.tsx — un solo posto per la
 * query e per la soglia, mai duplicata.
 */
export async function getStuckSignupBonuses(tenantId: string): Promise<StuckSignupBonus[]> {
  const supabase = createServiceClient();

  const cutoffIso = new Date(
    Date.now() - STUCK_SIGNUP_BONUS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: rows } = await supabase
    .from('points_ledger')
    .select('id, customer_id, amount, created_at')
    .eq('tenant_id', tenantId)
    .eq('transaction_type', 'SIGNUP_BONUS')
    .eq('status', 'PENDING')
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true });

  if (!rows || rows.length === 0) return [];

  const customerIds = rows.map((r) => r.customer_id);

  const [{ data: customers }, { data: deliveredOrders }] = await Promise.all([
    supabase.from('customers').select('id, email, full_name').in('id', customerIds),
    supabase
      .from('orders')
      .select('customer_id')
      .eq('tenant_id', tenantId)
      .eq('status', 'delivered')
      .in('customer_id', customerIds),
  ]);

  const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
  const deliveredCustomerIds = new Set((deliveredOrders ?? []).map((o) => o.customer_id));

  return rows.map((row) => {
    const customer = customerById.get(row.customer_id);
    return {
      ledgerEntryId: row.id,
      customerId: row.customer_id,
      customerEmail: customer?.email ?? '—',
      customerFullName: customer?.full_name ?? null,
      amount: row.amount,
      createdAt: row.created_at,
      hasDeliveredOrder: deliveredCustomerIds.has(row.customer_id),
    };
  });
}
