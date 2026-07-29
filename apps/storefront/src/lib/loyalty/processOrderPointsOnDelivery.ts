import { createServiceClient } from '@/lib/supabase/server';
import { resolveReferralChain } from './resolveReferralChain';
import { checkReferralAccessUnlock } from './checkReferralAccessUnlock';
import { checkFraudSignals } from './checkFraudSignals';

interface OrderPointsEntry {
  tenantId: string;
  customerId: string;
  amount: number;
  status: 'PENDING' | 'CONFIRMED';
  transactionType: 'PURCHASE_EARNED' | 'REFERRAL_EARNED';
  referralLevel?: number;
  pctApplied?: number;
  referenceCustomerId?: string;
  requiresManualReview?: boolean;
}

function normalizeAddress(shippingAddress: unknown): string | null {
  if (!shippingAddress || typeof shippingAddress !== 'object') return null;
  const addr = shippingAddress as { line1?: string; postal_code?: string };
  if (!addr.line1 || !addr.postal_code) return null;
  return `${addr.line1}|${addr.postal_code}`.trim().toLowerCase();
}

/**
 * Interpretazione (non esplicitata testualmente nel prompt, dedotta dalla
 * regola di business "punti PENDING fino a delivered, mai a pagamento" +
 * dal linguaggio dello step 5 che descrive l'eccezione "resta bloccata in
 * PENDING" per FLAG_FOR_REVIEW): dato che questa funzione gira esattamente
 * al momento in cui l'ordine diventa 'delivered', le righe non toccate
 * dall'anti-frode passano direttamente a CONFIRMED — è questo il punto in
 * cui il PENDING si risolve. Solo l'eccezione FLAG_FOR_REVIEW resta PENDING,
 * come esplicitamente richiesto.
 */
export async function processOrderPointsOnDelivery(orderId: string): Promise<void> {
  const supabase = createServiceClient();

  // ── 1. Fetch ordine ────────────────────────────────────────────────────────
  const { data: order } = await supabase
    .from('orders')
    .select('id, tenant_id, customer_id, total, status, points_processed, shipping_address')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.points_processed || order.status !== 'delivered') return;
  if (!order.customer_id) return; // ordine guest senza account, nessun customer a cui accreditare punti

  const buyerId = order.customer_id as string;
  const tenantId = order.tenant_id as string;

  // ── 2. Fetch config tenant ─────────────────────────────────────────────────
  const { data: tenant } = await supabase
    .from('tenants')
    .select('loyalty_enabled, referral_max_depth, purchase_points_rate, referral_fraud_max_conversions, referral_fraud_period_days, referral_fraud_action')
    .eq('id', tenantId)
    .single();

  // ── 3. Feature flag ────────────────────────────────────────────────────────
  if (!tenant || !tenant.loyalty_enabled) return;

  // ── 4. Costruisci entries ──────────────────────────────────────────────────
  const basePoints = Math.round(Number(order.total) * tenant.purchase_points_rate);

  const entries: OrderPointsEntry[] = [
    {
      tenantId,
      customerId: buyerId,
      amount: basePoints,
      status: 'CONFIRMED',
      transactionType: 'PURCHASE_EARNED',
    },
  ];

  const chain = await resolveReferralChain(tenantId, buyerId, tenant.referral_max_depth);

  if (chain.length > 0) {
    const { data: activeTiers } = await supabase
      .from('tenant_referral_tiers')
      .select('level, pct')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);

    const pctByLevel = new Map<number, number>((activeTiers ?? []).map((t) => [t.level, Number(t.pct)]));

    const { data: buyer } = await supabase.from('customers').select('phone').eq('id', buyerId).single();
    const buyerAddressKey = normalizeAddress(order.shipping_address);

    const cutoffIso = new Date(
      Date.now() - tenant.referral_fraud_period_days * 24 * 60 * 60 * 1000,
    ).toISOString();

    for (const node of chain) {
      const pct = pctByLevel.get(node.level);
      if (pct === undefined) continue; // livello senza percentuale configurata → skip, non errore

      const { data: sponsor } = await supabase
        .from('customers')
        .select('phone, referral_suspended')
        .eq('id', node.customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      // Sospeso da una precedente AUTO_BLOCK: nessun nuovo punto finché non
      // viene riabilitato manualmente (altrimenti AUTO_BLOCK non avrebbe
      // alcun effetto oltre l'ordine che lo ha innescato).
      if (sponsor?.referral_suspended) continue;

      // Segnale anti-frode telefono/indirizzo — noto solo ora (primo ordine),
      // non a signup. Solo accumulo di segnale per revisione admin, il gate
      // automatico resta il conteggio conversioni sotto.
      const { data: sponsorOrders } = await supabase
        .from('orders')
        .select('shipping_address')
        .eq('tenant_id', tenantId)
        .eq('customer_id', node.customerId);
      const sponsorAddressKeys = (sponsorOrders ?? []).map((o) => normalizeAddress(o.shipping_address));
      const matchingSponsorAddress = sponsorAddressKeys.find((k) => k && k === buyerAddressKey) ?? null;

      await checkFraudSignals({
        tenantId,
        newCustomerId: buyerId,
        sponsorId: node.customerId,
        signals: { SAME_PHONE: buyer?.phone, SAME_SHIPPING_ADDRESS: buyerAddressKey },
        sponsorSignals: { SAME_PHONE: sponsor?.phone, SAME_SHIPPING_ADDRESS: matchingSponsorAddress },
      });

      // ── 5. Conteggio conversioni confermate nella finestra ────────────────
      const { count: recentConversions } = await supabase
        .from('points_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('customer_id', node.customerId)
        .eq('transaction_type', 'REFERRAL_EARNED')
        .eq('status', 'CONFIRMED')
        .gte('created_at', cutoffIso);

      const overThreshold = (recentConversions ?? 0) >= tenant.referral_fraud_max_conversions;

      if (overThreshold) {
        if (tenant.referral_fraud_action === 'CAP_AT_THRESHOLD') {
          continue; // riga omessa silenziosamente
        }
        if (tenant.referral_fraud_action === 'AUTO_BLOCK') {
          await supabase
            .from('customers')
            .update({ referral_suspended: true })
            .eq('id', node.customerId)
            .eq('tenant_id', tenantId);
          continue; // riga omessa
        }
        // FLAG_FOR_REVIEW: la riga viene comunque inserita, ma resta PENDING
        entries.push({
          tenantId,
          customerId: node.customerId,
          amount: Math.round(basePoints * pct),
          status: 'PENDING',
          transactionType: 'REFERRAL_EARNED',
          referralLevel: node.level,
          pctApplied: pct,
          referenceCustomerId: buyerId,
          requiresManualReview: true,
        });
        continue;
      }

      entries.push({
        tenantId,
        customerId: node.customerId,
        amount: Math.round(basePoints * pct),
        status: 'CONFIRMED',
        transactionType: 'REFERRAL_EARNED',
        referralLevel: node.level,
        pctApplied: pct,
        referenceCustomerId: buyerId,
      });
    }
  }

  // ── 6. RPC atomica ──────────────────────────────────────────────────────────
  const { error } = await supabase.rpc('process_order_points_atomic', {
    p_order_id: orderId,
    p_entries: entries,
  });
  if (error) throw error;

  // ── 6b. Conferma SIGNUP_BONUS al primo ordine consegnato ─────────────────────
  // Scelta: UPDATE della riga esistente (PENDING→CONFIRMED), non una nuova riga
  // di conferma — riusa esattamente il meccanismo di confirm-reviewed-entry
  // (l'unica transizione di stato già esistente su una riga ledger preesistente
  // nel progetto), non un meccanismo nuovo. Un INSERT equivalente duplicherebbe
  // l'importo a meno di lasciare la riga PENDING originale a marcire nel ledger
  // (doppio conteggio in pending_balance) — l'UPDATE è l'unica opzione che non
  // rischia doppio conteggio.
  // Non nella stessa transazione DB di process_order_points_atomic (che accetta
  // solo INSERT di nuove entries, non tocca righe esistenti) — estendere quella
  // funzione SQL è fuori dallo scope di questo fix mirato. Stessa classe di
  // rischio "post-idempotenza" già presente allo step 7 sottostante
  // (checkReferralAccessUnlock gira anch'esso dopo che points_processed è già
  // stato marcato true, senza garanzie transazionali con la RPC).
  const { count: priorDeliveredCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('customer_id', buyerId)
    .eq('status', 'delivered')
    .neq('id', orderId);

  if ((priorDeliveredCount ?? 0) === 0) {
    await supabase
      .from('points_ledger')
      .update({ status: 'CONFIRMED' })
      .eq('tenant_id', tenantId)
      .eq('customer_id', buyerId)
      .eq('transaction_type', 'SIGNUP_BONUS')
      .eq('status', 'PENDING');
  }

  // ── 7. Sblocco eleggibilità referral per l'acquirente ────────────────────────
  await checkReferralAccessUnlock(tenantId, buyerId);
}
