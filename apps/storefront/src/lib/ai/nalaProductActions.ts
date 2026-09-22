import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildValidatedNalaProductActions,
  shouldOfferNalaProductAction,
  type NalaCanonicalProduct,
  type NalaProductAction,
  type NalaProductActionCandidate,
} from '@/lib/ai/nalaProductActionContract';

export async function buildNalaProductActions(params: {
  supabase: SupabaseClient;
  tenantId: string;
  interactionId: string | null;
  message: string;
  locale: unknown;
  currency: string;
  candidates: NalaProductActionCandidate[];
}): Promise<NalaProductAction[]> {
  if (!params.interactionId || !shouldOfferNalaProductAction(params.message)) return [];

  const candidateIds = [...new Set(params.candidates.map((candidate) => candidate.id))];
  if (candidateIds.length === 0) return [];

  try {
    const { data, error } = await params.supabase
      .from('products')
      .select('id, tenant_id, name, slug, image_url, price, compare_at_price, stock, active, weight_grams, storage_type, min_order_quantity, order_quantity_step')
      .eq('tenant_id', params.tenantId)
      .eq('active', true)
      .in('id', candidateIds);

    if (error) throw new Error(error.message);

    const { data: groupRows, error: groupsError } = await params.supabase
      .from('purchase_quantity_groups')
      .select('id, name, min_quantity, quantity_step, purchase_quantity_group_products(product_id)')
      .eq('tenant_id', params.tenantId)
      .eq('active', true);
    if (groupsError) console.warn('[nala-product-actions] Group metadata temporarily unavailable:', groupsError);

    const groups = (groupRows ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      min_quantity: group.min_quantity,
      quantity_step: group.quantity_step,
      productIds: (group.purchase_quantity_group_products as Array<{ product_id: string }>)
        .map((member) => member.product_id),
    }));

    return buildValidatedNalaProductActions({
      tenantId: params.tenantId,
      interactionId: params.interactionId,
      currency: params.currency,
      locale: params.locale,
      candidates: params.candidates,
      products: (data ?? []) as NalaCanonicalProduct[],
      groups,
    });
  } catch (error) {
    console.error('[nala-product-actions] Canonical product validation failed; omitting actions.', {
      tenantId: params.tenantId,
      error,
    });
    return [];
  }
}
