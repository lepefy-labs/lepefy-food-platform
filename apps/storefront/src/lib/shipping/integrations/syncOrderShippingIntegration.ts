import { createServiceClient } from '@/lib/supabase/server';
import { runOrderTransitionSideEffects } from '@/lib/orders/adminOrderWorkflow';
import { getShippingIntegrationAdapter } from './registry';
import type {
  ShippingDetailsWithIntegration,
  ShippingIntegrationSnapshot,
} from './types';
import type { OrderStatus } from '@lepefy/types';

interface SyncTenant {
  id: string;
  shipping_provider: string;
  packlink_api_key: string | null;
}

interface SyncOrder {
  id: string;
  tenant_id: string;
  status: OrderStatus;
  email: string;
  full_name: string | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_details: Record<string, unknown> | null;
  tracking_code: string | null;
  tracking_carrier: string | null;
  packing_completed_at: string | null;
  packing_parcel_count: number | null;
}

interface PickingItem {
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

export interface ShippingSyncResult {
  orderId: string;
  provider: string;
  reference: string;
  snapshot: ShippingIntegrationSnapshot;
  previousStatus: OrderStatus;
  finalStatus: OrderStatus;
  transitions: OrderStatus[];
  blockedReason: string | null;
}

function detailsWithIntegration(
  current: Record<string, unknown> | null,
  integration: ShippingIntegrationSnapshot,
): ShippingDetailsWithIntegration {
  return {
    ...(current ?? {}),
    integration,
  };
}

function firstTransitTimestamp(snapshot: ShippingIntegrationSnapshot): string | null {
  const event = snapshot.events.find(item => {
    const code = item.statusCode.toUpperCase();
    return code.includes('IN_TRANSIT') || code.includes('OUT_FOR_DELIVERY') || code.includes('DELIVERED');
  });
  if (!event?.timestamp) return null;
  const date = new Date(event.timestamp * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function preparationBlockReason(order: SyncOrder): Promise<string | null> {
  if (!order.packing_completed_at || !order.packing_parcel_count || order.packing_parcel_count < 1) {
    return 'Packing incomplet : validez les colis avant la synchronisation de l’expédition.';
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('order_items')
    .select('storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id)
    .eq('tenant_id', order.tenant_id);

  if (error) return 'Impossible de vérifier la préparation de la commande.';
  const items = (data ?? []) as unknown as PickingItem[];
  if (items.length === 0) return 'La commande ne contient aucun article à préparer.';

  const unpicked = items.filter(item => !item.picked_at).length;
  const coldUnchecked = items.filter(item =>
    (item.storage_type === 'fresh' || item.storage_type === 'frozen')
    && !item.cold_chain_checked_at,
  ).length;

  if (unpicked === 0 && coldUnchecked === 0) return null;
  const parts: string[] = [];
  if (unpicked > 0) parts.push(`${unpicked} ligne${unpicked > 1 ? 's' : ''} non prélevée${unpicked > 1 ? 's' : ''}`);
  if (coldUnchecked > 0) parts.push(`${coldUnchecked} contrôle${coldUnchecked > 1 ? 's' : ''} froid manquant${coldUnchecked > 1 ? 's' : ''}`);
  return `Préparation incomplète : ${parts.join(' · ')}.`;
}

async function applyTransition(
  order: SyncOrder,
  nextStatus: 'shipped' | 'delivered',
  snapshot: ShippingIntegrationSnapshot,
): Promise<boolean> {
  const supabase = createServiceClient();
  const update: Record<string, unknown> = { status: nextStatus };
  if (nextStatus === 'shipped') {
    update.shipped_at = firstTransitTimestamp(snapshot) ?? new Date().toISOString();
  }

  const { data, error } = await supabase
    .from('orders')
    .update(update)
    .eq('id', order.id)
    .eq('tenant_id', order.tenant_id)
    .eq('status', order.status)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;

  await runOrderTransitionSideEffects({
    tenantId: order.tenant_id,
    orderId: order.id,
    previousStatus: order.status,
    nextStatus,
    email: order.email,
    fullName: order.full_name,
    fulfillmentType: order.fulfillment_type,
    trackingCode: snapshot.trackingCode ?? order.tracking_code,
    trackingCarrier: snapshot.carrier ?? order.tracking_carrier,
  });

  order.status = nextStatus;
  return true;
}

export async function syncOrderShippingIntegration({
  tenant,
  order,
  reference,
}: {
  tenant: SyncTenant;
  order: SyncOrder;
  reference?: string;
}): Promise<ShippingSyncResult> {
  if (order.fulfillment_type !== 'delivery') throw new Error('Cette commande n’est pas une livraison.');

  const adapter = getShippingIntegrationAdapter(tenant.shipping_provider);
  if (!adapter) throw new Error(`Aucune synchronisation automatique pour le provider ${tenant.shipping_provider}.`);

  const existing = (order.shipping_details ?? {}) as ShippingDetailsWithIntegration;
  const effectiveReference = (reference ?? existing.integration?.reference ?? '').trim();
  if (!effectiveReference) throw new Error('Référence de livraison requise.');

  const snapshot = await adapter.fetchShipment(effectiveReference, {
    tenantId: tenant.id,
    provider: tenant.shipping_provider,
    packlinkApiKey: tenant.packlink_api_key,
  });

  let blockedReason: string | null = null;
  if ((snapshot.state === 'in_transit' || snapshot.state === 'delivered') && order.status === 'new') {
    blockedReason = 'La commande doit d’abord être mise en préparation.';
  } else if ((snapshot.state === 'in_transit' || snapshot.state === 'delivered') && order.status === 'preparing') {
    if (!snapshot.trackingCode) {
      blockedReason = 'Le provider indique un départ mais aucun numéro de suivi n’est disponible.';
    } else {
      blockedReason = await preparationBlockReason(order);
    }
  }

  snapshot.syncBlockedReason = blockedReason;
  const mergedDetails = detailsWithIntegration(order.shipping_details, snapshot);
  const supabase = createServiceClient();
  const logisticsUpdate: Record<string, unknown> = {
    shipping_details: mergedDetails,
  };
  if (snapshot.trackingCode) logisticsUpdate.tracking_code = snapshot.trackingCode;
  if (snapshot.carrier) logisticsUpdate.tracking_carrier = snapshot.carrier;

  const { error: metadataError } = await supabase
    .from('orders')
    .update(logisticsUpdate)
    .eq('id', order.id)
    .eq('tenant_id', order.tenant_id);
  if (metadataError) throw metadataError;

  const previousStatus = order.status;
  const transitions: OrderStatus[] = [];

  if (!blockedReason && (snapshot.state === 'in_transit' || snapshot.state === 'delivered') && order.status === 'preparing') {
    if (await applyTransition(order, 'shipped', snapshot)) transitions.push('shipped');
  }

  if (snapshot.state === 'delivered' && order.status === 'shipped') {
    if (await applyTransition(order, 'delivered', snapshot)) transitions.push('delivered');
  }

  return {
    orderId: order.id,
    provider: adapter.key,
    reference: snapshot.reference,
    snapshot,
    previousStatus,
    finalStatus: order.status,
    transitions,
    blockedReason,
  };
}

export type { SyncTenant, SyncOrder };
