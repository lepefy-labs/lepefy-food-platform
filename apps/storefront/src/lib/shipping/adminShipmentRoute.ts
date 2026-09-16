import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { loadWorkflowOrder, OrderWorkflowError, updateWorkflowOrder } from '@/lib/orders/orderTransitionService';
import { ShippingProviderError } from './providers/types';
import { syncOrderShipment } from './syncOrderShipment';

export async function handleAdminShipment(request: NextRequest, orderId: string, action: 'attach' | 'sync' | 'manual') {
  const headers = { 'Cache-Control': 'no-store' };
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  try {
    const service = createServiceClient();
    if (action === 'manual') {
      const order = await loadWorkflowOrder(service, tenant.id, orderId);
      if (order.fulfillment_type !== 'delivery' || !['preparing', 'shipped'].includes(order.status)) throw new OrderWorkflowError('Suivi manuel indisponible.');
      await updateWorkflowOrder({ service, order, source: 'manual_fallback', patch: {
        shipping_tracking_mode: 'manual', shipping_provider_key: null, shipping_provider_reference: null,
        shipping_provider_status: null, shipping_normalized_status: null, shipping_provider_synced_at: null,
        shipping_sync_error: null, shipping_tracking_url: null, shipping_tracking_events: null, shipping_estimated_delivery_at: null,
      } });
    } else {
      let reference: string | undefined;
      if (action === 'attach') {
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some(key => key !== 'providerReference')) throw new OrderWorkflowError('Corps invalide.', 400);
        const value = (body as Record<string, unknown>).providerReference;
        if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new OrderWorkflowError('Référence invalide.', 400);
        reference = value.trim();
      }
      await syncOrderShipment(service, tenant.id, orderId, reference);
    }
    return NextResponse.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof OrderWorkflowError) return NextResponse.json({ error: error.message }, { status: error.httpStatus, headers });
    if (error instanceof ShippingProviderError) return NextResponse.json({ error: 'Impossible de vérifier l’expédition.', code: error.code }, { status: 422, headers });
    console.error('[admin/shipment] operation failed');
    return NextResponse.json({ error: 'Synchronisation indisponible.' }, { status: 503, headers });
  }
}
