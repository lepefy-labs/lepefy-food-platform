import { createServiceClient } from '@/lib/supabase/server';
import { getAmbassadorSponsor } from './getAmbassadorSponsor';
import { calculateAmbassadorDiscount } from './calculateAmbassadorDiscount';
import { calculateSplitPoolAmounts } from './calculateSplitPool';
import type { Tenant } from '@lepefy/types';

type AmbassadorTenantConfig = Pick<
  Tenant,
  | 'id'
  | 'ambassador_min_purchase_amount'
  | 'ambassador_commission_mode'
  | 'ambassador_split_pool_amount'
  | 'ambassador_split_pool_ambassador_percent'
  | 'ambassador_first_order_discount_type'
  | 'ambassador_first_order_discount_value'
>;

/**
 * Decisione sconto primo ordine — chiamata da POST /api/checkout (fonte di
 * verità, fissa l'importo realmente addebitato) e dall'endpoint di anteprima
 * /api/checkout/ambassador-discount (stessa logica, per mostrare la riga
 * "Réduction parrainage" nel récapitulatif PRIMA della conferma).
 *
 * Riservato ai clienti con un compte (customerId non null) : referred_by_id
 * vive solo su customers, un guest checkout non ha modo di essere collegato
 * a uno sponsor — vedi assunzioni nel rapport final.
 *
 * Condizioni di sblocco (sponsor ambassador, primo ordine, subtotale >=
 * soglia condivisa) identiche nelle due modalità (051) — solo la formula
 * dello sconto cambia a seconda di tenant.ambassador_commission_mode.
 */
export async function resolveCheckoutAmbassadorDiscount(params: {
  tenant: AmbassadorTenantConfig;
  customerId: string | null;
  subtotal: number;
}): Promise<number> {
  const { tenant, customerId, subtotal } = params;

  if (!customerId) return 0;

  const sponsorId = await getAmbassadorSponsor(tenant.id, customerId);
  if (!sponsorId) return 0;

  const supabase = createServiceClient();
  const { count: priorOrdersCount } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenant.id)
    .eq('customer_id', customerId);

  if ((priorOrdersCount ?? 0) > 0) return 0;

  if (tenant.ambassador_commission_mode === 'SPLIT_POOL') {
    if (subtotal < tenant.ambassador_min_purchase_amount) return 0;

    return calculateSplitPoolAmounts({
      poolAmount: tenant.ambassador_split_pool_amount,
      ambassadorPercent: tenant.ambassador_split_pool_ambassador_percent,
    }).referredDiscount;
  }

  if (!tenant.ambassador_first_order_discount_type) return 0;

  return calculateAmbassadorDiscount(subtotal, {
    minPurchaseAmount: tenant.ambassador_min_purchase_amount,
    discountType: tenant.ambassador_first_order_discount_type,
    discountValue: tenant.ambassador_first_order_discount_value,
  });
}
