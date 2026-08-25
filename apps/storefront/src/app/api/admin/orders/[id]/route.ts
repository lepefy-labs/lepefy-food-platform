import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  isOrderStatus,
  runOrderTransitionSideEffects,
  validateOrderTransition,
  type FulfillmentType,
} from '@/lib/orders/adminOrderWorkflow';
import type { OrderStatus, PaymentStatus } from '@lepefy/types';

interface PatchBody {
  status?: OrderStatus;
  tracking_carrier?: string | null;
  tracking_code?: string | null;
  notes?: string | null;
  payment_status?: PaymentStatus;
}

interface ExistingOrder {
  id: string;
  status: OrderStatus;
  email: string;
  full_name: string | null;
  fulfillment_type: FulfillmentType;
  tracking_code: string | null;
  tracking_carrier: string | null;
  picking_started_at: string | null;
}

interface PickingItemRow {
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

function pickingError(items: PickingItemRow[]) {
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  try {
    const body: PatchBody = await req.json();
    const { status, tracking_carrier, tracking_code, notes, payment_status } = body;
    const supabase = createServiceClient();

    const { data: existingRaw, error: fetchError } = await supabase
      .from('orders')
      .select('id, status, email, full_name, fulfillment_type, tracking_code, tracking_carrier, picking_started_at')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .single();

    if (fetchError || !existingRaw) {
      return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
    }

    const existing = existingRaw as unknown as ExistingOrder;
    const update: Record<string, unknown> = {};

    if (status !== undefined) {
      if (!isOrderStatus(status)) {
        return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 });
      }

      const effectiveTrackingCode = tracking_code !== undefined
        ? tracking_code
        : existing.tracking_code;

      const validation = validateOrderTransition({
        current: existing.status,
        next: status,
        fulfillmentType: existing.fulfillment_type,
        trackingCode: effectiveTrackingCode,
      });

      if (!validation.ok) {
        return NextResponse.json({ error: validation.error }, { status: 409 });
      }

      const finishingPreparation = existing.status === 'preparing'
        && (status === 'shipped' || status === 'ready_for_pickup');

      if (finishingPreparation) {
        const { data: pickingItemsRaw, error: pickingFetchError } = await supabase
          .from('order_items')
          .select('storage_type, picked_at, cold_chain_checked_at')
          .eq('order_id', existing.id)
          .eq('tenant_id', tenant.id);

        if (pickingFetchError) {
          console.error('[admin/orders PATCH] picking fetch error:', pickingFetchError, '— order_id:', existing.id);
          return NextResponse.json({ error: 'Impossible de vérifier la préparation.' }, { status: 500 });
        }

        const error = pickingError((pickingItemsRaw ?? []) as PickingItemRow[]);
        if (error) return NextResponse.json({ error }, { status: 409 });
      }

      update.status = status;
      if (status === 'preparing' && existing.status === 'new' && !existing.picking_started_at) {
        update.picking_started_at = new Date().toISOString();
      }
      if (status === 'shipped' && existing.status !== 'shipped') {
        update.shipped_at = new Date().toISOString();
      }
    }

    if (tracking_carrier !== undefined) update.tracking_carrier = tracking_carrier;
    if (tracking_code !== undefined) update.tracking_code = tracking_code;
    if (notes !== undefined) update.notes = notes;

    if (payment_status !== undefined) {
      const validPaymentStatuses: PaymentStatus[] = ['pending', 'paid', 'failed', 'refunded'];
      if (!validPaymentStatuses.includes(payment_status)) {
        return NextResponse.json({ error: 'Statut de paiement invalide.' }, { status: 400 });
      }
      update.payment_status = payment_status;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Aucun champ à mettre à jour.' }, { status: 400 });
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update(update)
      .eq('id', params.id)
      .eq('tenant_id', tenant.id);

    if (updateError) {
      console.error('[admin/orders PATCH] update error:', updateError, '— order_id:', params.id);
      return NextResponse.json({ error: 'Erreur lors de la mise à jour.' }, { status: 500 });
    }

    if (status !== undefined) {
      await runOrderTransitionSideEffects({
        orderId: params.id,
        previousStatus: existing.status,
        nextStatus: status,
        email: existing.email,
        fullName: existing.full_name,
        trackingCode: tracking_code !== undefined ? tracking_code : existing.tracking_code,
        trackingCarrier: tracking_carrier !== undefined ? tracking_carrier : existing.tracking_carrier,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[admin/orders PATCH] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
