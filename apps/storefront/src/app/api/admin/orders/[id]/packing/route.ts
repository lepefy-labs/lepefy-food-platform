import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { preparationState, type PreparationOrder } from '@/lib/orders/preparation/preparationPolicy';
import { isMissingPreparationColumn, withoutPreparationColumns } from '@/lib/orders/preparation/compat';
import { readTenantPreparationMode } from '@/lib/orders/preparation/settings';

const PACKING_COLUMNS = 'id, status, fulfillment_type, packing_started_at, packing_completed_at, cold_chain_packing_checked_at, picking_completed_at, preparation_mode, paper_preparation_completed_at';

interface PackingBody {
  parcel_count?: number | null;
  cold_chain_checked?: boolean;
  /** Mode « emballage froid sur papier » : déclaration que l'emballage a été fait selon la liste. */
  cold_chain_declared?: boolean;
}

interface OrderRow extends PreparationOrder {
  id: string;
  packing_started_at: string | null;
}

interface ItemRow {
  storage_type: 'dry' | 'fresh' | 'frozen' | null;
  picked_at: string | null;
  cold_chain_checked_at: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as PackingBody;
  const supabase = createServiceClient();

  const readOrder = (columns: string) => supabase.from('orders').select(columns).eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  let { data: orderRaw, error: orderError } = await readOrder(PACKING_COLUMNS);
  if (isMissingPreparationColumn(orderError)) ({ data: orderRaw, error: orderError } = await readOrder(withoutPreparationColumns(PACKING_COLUMNS)));

  if (orderError || !orderRaw) {
    return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  }

  const order = orderRaw as unknown as OrderRow;
  if (order.fulfillment_type !== 'delivery') {
    return NextResponse.json({ error: 'L’emballage est réservé aux commandes en livraison.' }, { status: 409 });
  }
  if (order.status !== 'preparing') {
    return NextResponse.json({ error: 'L’emballage peut être modifié uniquement pendant la préparation.' }, { status: 409 });
  }

  const { data: itemsRaw, error: itemsError } = await supabase
    .from('order_items')
    .select('storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id)
    .eq('tenant_id', tenant.id);

  if (itemsError) {
    return NextResponse.json({ error: 'Impossible de vérifier la préparation.' }, { status: 500 });
  }

  const items = (itemsRaw ?? []) as ItemRow[];
  // Same rule as the transition: digital checklist, paper declaration or « sans confirmation ».
  // No snapshot: the tenant's current mode applies while nothing digital was recorded (saved below with the packing).
  if (!order.preparation_mode) order.tenantPreparationMode = await readTenantPreparationMode(supabase, tenant.id);
  const state = preparationState(order, items);
  if (!state.pickingDone) {
    return NextResponse.json({
      error: state.mode.picking === 'paper'
        ? 'Confirmez d’abord « Préparation terminée » avant l’emballage.'
        : 'Terminez la préparation et les contrôles froid avant l’emballage.',
    }, { status: 409 });
  }

  const hasColdChain = state.hasColdChain;
  const parcelCount = body.parcel_count == null ? null : Number(body.parcel_count);
  if (parcelCount !== null && (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 99)) {
    return NextResponse.json({ error: 'Le nombre de colis doit être compris entre 1 et 99.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const coldMode = state.mode.cold_chain_packing;
  // Each mode writes only its own column: a paper declaration never fills the digital check.
  const coldCheckedAt = hasColdChain && coldMode === 'digital' && body.cold_chain_checked === true ? now : null;
  const coldDeclaredAt = hasColdChain && coldMode === 'paper' && body.cold_chain_declared === true ? now : null;
  const coldOk = !hasColdChain || coldMode === 'none' || coldCheckedAt !== null || coldDeclaredAt !== null;
  const complete = parcelCount !== null && coldOk;

  const update = {
    packing_started_at: order.packing_started_at ?? now,
    packing_parcel_count: parcelCount,
    cold_chain_packing_checked_at: coldCheckedAt,
    ...(coldMode === 'paper' ? { cold_chain_packing_declared_at: coldDeclaredAt } : {}),
    // packing_completed_at = emballage validé dans Lepefy (colis + contrôle froid numérique ou sans objet).
    packing_completed_at: complete && coldDeclaredAt === null ? now : null,
    ...(state.modeSource === 'tenant' ? { preparation_mode: state.mode } : {}),
  };

  const { error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('id', order.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'preparing');

  if (updateError) {
    console.error('[admin/orders packing] update failed:', updateError, '— order_id:', order.id);
    return NextResponse.json({ error: 'Impossible d’enregistrer l’emballage.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    packing: {
      parcel_count: parcelCount,
      cold_chain_checked: coldCheckedAt !== null,
      cold_chain_declared: coldDeclaredAt !== null,
      complete,
    },
  });
}
