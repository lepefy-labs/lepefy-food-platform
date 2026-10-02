import type { createServiceClient } from '@/lib/supabase/server';

type ServiceClient = ReturnType<typeof createServiceClient>;

/** Both reads are tenant-scoped even when a valid order UUID from another shop is supplied. */
export async function loadOrderOperationPreparation(db: ServiceClient, tenantId: string, orderId: string) {
  const orderResult = await db.from('orders').select('id, fulfillment_type, status, shipping_details')
    .eq('tenant_id', tenantId).eq('id', orderId).maybeSingle();
  if (orderResult.error) throw new Error('order_unavailable');
  if (!orderResult.data) return null;
  if (orderResult.data.fulfillment_type === 'pickup' || orderResult.data.status === 'cancelled')
    return { order: orderResult.data, items: [] };
  const itemResult = await db.from('order_items').select('product_id, quantity')
    .eq('tenant_id', tenantId).eq('order_id', orderId);
  if (itemResult.error) throw new Error('items_unavailable');
  return { order: orderResult.data, items: itemResult.data ?? [] };
}
