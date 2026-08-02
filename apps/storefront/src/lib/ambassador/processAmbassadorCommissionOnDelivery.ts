import { createServiceClient } from '@/lib/supabase/server';

export interface AmbassadorDeliveryContext {
  /** true se referred_by_id del buyer punta a un customer con is_ambassador=true (permanente, non solo al primo ordine). */
  sponsorIsAmbassador: boolean;
  /** true se questo è il primo ordine CONSEGNATO del buyer (nessun altro delivered, esclusa questa riga). */
  isFirstDeliveredOrder: boolean;
  /** true se orders.ambassador_discount_amount > 0 per questo ordine. */
  discountWasApplied: boolean;
}

/**
 * Punto d'ingresso "ambassador" al momento della consegna — gira SEMPRE,
 * indipendentemente da tenants.loyalty_enabled (il programma ambassador è
 * separato dal sistema loyalty/referral esistente, vedi 046). Chiamata dallo
 * stesso punto esatto di processOrderPointsOnDelivery (PATCH
 * /admin/orders/[id]), non dentro di essa, per non far dipendere l'una
 * dall'altra.
 *
 * Ritorna il contesto ambassador (usato da processOrderPointsOnDelivery per
 * decidere se escludere il buyer/lo sponsor dai punti) anche quando non
 * viene generata alcuna commissione (soglia non raggiunta) — l'esclusione
 * "l'ambassador non riceve mai punti" resta valida a prescindere dal fatto
 * che la commissione sia stata effettivamente creata.
 */
export async function processAmbassadorCommissionOnDelivery(orderId: string): Promise<AmbassadorDeliveryContext> {
  const none: AmbassadorDeliveryContext = {
    sponsorIsAmbassador: false,
    isFirstDeliveredOrder: false,
    discountWasApplied: false,
  };

  const supabase = createServiceClient();

  const { data: order } = await supabase
    .from('orders')
    .select('id, tenant_id, customer_id, status, subtotal, ambassador_discount_amount, ambassador_commission_processed')
    .eq('id', orderId)
    .maybeSingle();

  if (!order || order.status !== 'delivered' || !order.customer_id) return none;

  const tenantId = order.tenant_id as string;
  const buyerId   = order.customer_id as string;

  const { data: buyer } = await supabase
    .from('customers')
    .select('referred_by_id')
    .eq('id', buyerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  const sponsorId = (buyer?.referred_by_id as string | null) ?? null;

  let sponsorIsAmbassador = false;
  if (sponsorId) {
    const { data: sponsor } = await supabase
      .from('customers')
      .select('is_ambassador')
      .eq('id', sponsorId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    sponsorIsAmbassador = sponsor?.is_ambassador === true;
  }

  const { count: priorDeliveredCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('customer_id', buyerId)
    .eq('status', 'delivered')
    .neq('id', orderId);

  const isFirstDeliveredOrder = (priorDeliveredCount ?? 0) === 0;
  const discountWasApplied = Number(order.ambassador_discount_amount) > 0;

  if (!order.ambassador_commission_processed && sponsorIsAmbassador && isFirstDeliveredOrder) {
    const { error } = await supabase.rpc('process_ambassador_commission_atomic', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_referred_customer_id: buyerId,
      p_order_subtotal: Number(order.subtotal),
      p_discount_applied: Number(order.ambassador_discount_amount),
    });
    if (error) throw error;
  } else if (!order.ambassador_commission_processed) {
    // Non idoneo per commissione (nessuno sponsor ambassador, o non è il
    // primo ordine consegnato) — marca comunque processed, stesso schema di
    // idempotenza di points_processed, per non ripetere questi controlli a
    // ogni transizione successiva sullo stesso ordine.
    await supabase
      .from('orders')
      .update({ ambassador_commission_processed: true, ambassador_commission_processed_at: new Date().toISOString() })
      .eq('id', orderId)
      .eq('tenant_id', tenantId);
  }

  return { sponsorIsAmbassador, isFirstDeliveredOrder, discountWasApplied };
}
