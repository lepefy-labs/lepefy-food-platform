import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

interface PatchBody {
  itemId?: string;
  picked?: boolean;
  coldChainChecked?: boolean;
}

interface PickingItemRow {
  id: string;
  order_id: string;
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

function progressFor(items: PickingItemRow[]) {
  const coldItems = items.filter(item => item.storage_type === 'fresh' || item.storage_type === 'frozen');
  const picked = items.filter(item => item.picked_at).length;
  const coldChecked = coldItems.filter(item => item.cold_chain_checked_at).length;
  const complete = items.length > 0
    && picked === items.length
    && coldChecked === coldItems.length;

  return {
    total: items.length,
    picked,
    coldRequired: coldItems.length,
    coldChecked,
    complete,
  };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as PatchBody | null;
  if (!body?.itemId || (body.picked === undefined && body.coldChainChecked === undefined)) {
    return NextResponse.json({ error: 'Modification de picking invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, picking_started_at, picking_completed_at')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (orderError || !order) {
    return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  }

  if (order.status !== 'preparing') {
    return NextResponse.json(
      { error: 'Le picking est modifiable uniquement pendant la préparation.' },
      { status: 409 },
    );
  }

  const { data: itemRaw, error: itemError } = await supabase
    .from('order_items')
    .select('id, order_id, storage_type, picked_at, cold_chain_checked_at')
    .eq('id', body.itemId)
    .eq('order_id', order.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (itemError || !itemRaw) {
    return NextResponse.json({ error: 'Produit de commande introuvable.' }, { status: 404 });
  }

  const item = itemRaw as PickingItemRow;
  const isCold = item.storage_type === 'fresh' || item.storage_type === 'frozen';
  const nowIso = new Date().toISOString();
  const update: Record<string, string | null> = {};

  if (body.picked !== undefined) {
    update.picked_at = body.picked ? nowIso : null;
    if (!body.picked) update.cold_chain_checked_at = null;
  }

  if (body.coldChainChecked !== undefined) {
    if (!isCold) {
      return NextResponse.json({ error: 'Ce produit ne nécessite pas de contrôle de chaîne du froid.' }, { status: 400 });
    }
    const effectivelyPicked = body.picked ?? Boolean(item.picked_at);
    if (body.coldChainChecked && !effectivelyPicked) {
      return NextResponse.json({ error: 'Marquez d’abord le produit comme prélevé.' }, { status: 409 });
    }
    update.cold_chain_checked_at = body.coldChainChecked ? nowIso : null;
  }

  const { error: updateError } = await supabase
    .from('order_items')
    .update(update)
    .eq('id', item.id)
    .eq('order_id', order.id)
    .eq('tenant_id', tenant.id);

  if (updateError) {
    console.error('[admin/orders/picking] item update failed:', updateError, '— order_id:', order.id, 'item_id:', item.id);
    return NextResponse.json({ error: 'Impossible de mettre à jour le picking.' }, { status: 500 });
  }

  if (!order.picking_started_at) {
    await supabase
      .from('orders')
      .update({ picking_started_at: nowIso })
      .eq('id', order.id)
      .eq('tenant_id', tenant.id)
      .is('picking_started_at', null);
  }

  const { data: allItemsRaw, error: allItemsError } = await supabase
    .from('order_items')
    .select('id, order_id, storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id)
    .eq('tenant_id', tenant.id);

  if (allItemsError) {
    console.error('[admin/orders/picking] progress fetch failed:', allItemsError, '— order_id:', order.id);
    return NextResponse.json({ error: 'Picking enregistré, mais progression indisponible.' }, { status: 500 });
  }

  const progress = progressFor((allItemsRaw ?? []) as PickingItemRow[]);
  const completedAt = progress.complete
    ? (order.picking_completed_at ?? nowIso)
    : null;

  const { error: progressUpdateError } = await supabase
    .from('orders')
    .update({ picking_completed_at: completedAt })
    .eq('id', order.id)
    .eq('tenant_id', tenant.id);

  if (progressUpdateError) {
    console.error('[admin/orders/picking] order progress update failed:', progressUpdateError, '— order_id:', order.id);
    return NextResponse.json({ error: 'Picking enregistré, mais statut de préparation non mis à jour.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, progress, pickingCompletedAt: completedAt });
}
