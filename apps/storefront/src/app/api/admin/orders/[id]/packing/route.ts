import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

interface PackingBody {
  parcel_count?: number | null;
  cold_chain_checked?: boolean;
}

interface OrderRow {
  id: string;
  status: string;
  fulfillment_type: string;
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

  const { data: orderRaw, error: orderError } = await supabase
    .from('orders')
    .select('id, status, fulfillment_type, packing_started_at')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (orderError || !orderRaw) {
    return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  }

  const order = orderRaw as unknown as OrderRow;
  if (order.fulfillment_type !== 'delivery') {
    return NextResponse.json({ error: 'Le packing est réservé aux commandes en livraison.' }, { status: 409 });
  }
  if (order.status !== 'preparing') {
    return NextResponse.json({ error: 'Le packing peut être modifié uniquement pendant la préparation.' }, { status: 409 });
  }

  const { data: itemsRaw, error: itemsError } = await supabase
    .from('order_items')
    .select('storage_type, picked_at, cold_chain_checked_at')
    .eq('order_id', order.id)
    .eq('tenant_id', tenant.id);

  if (itemsError) {
    return NextResponse.json({ error: 'Impossible de vérifier le picking.' }, { status: 500 });
  }

  const items = (itemsRaw ?? []) as ItemRow[];
  const pickingComplete = items.length > 0 && items.every(item => {
    if (!item.picked_at) return false;
    if (item.storage_type === 'fresh' || item.storage_type === 'frozen') {
      return Boolean(item.cold_chain_checked_at);
    }
    return true;
  });
  if (!pickingComplete) {
    return NextResponse.json({ error: 'Terminez le picking et les contrôles froid avant le packing.' }, { status: 409 });
  }

  const hasColdChain = items.some(item => item.storage_type === 'fresh' || item.storage_type === 'frozen');
  const parcelCount = body.parcel_count == null ? null : Number(body.parcel_count);
  if (parcelCount !== null && (!Number.isInteger(parcelCount) || parcelCount < 1 || parcelCount > 99)) {
    return NextResponse.json({ error: 'Le nombre de colis doit être compris entre 1 et 99.' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const coldCheckedAt = hasColdChain && body.cold_chain_checked === true ? now : null;
  const complete = parcelCount !== null && (!hasColdChain || coldCheckedAt !== null);

  const update = {
    packing_started_at: order.packing_started_at ?? now,
    packing_parcel_count: parcelCount,
    cold_chain_packing_checked_at: coldCheckedAt,
    packing_completed_at: complete ? now : null,
  };

  const { error: updateError } = await supabase
    .from('orders')
    .update(update)
    .eq('id', order.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'preparing');

  if (updateError) {
    console.error('[admin/orders packing] update failed:', updateError, '— order_id:', order.id);
    return NextResponse.json({ error: 'Impossible d’enregistrer le packing.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    packing: {
      parcel_count: parcelCount,
      cold_chain_checked: coldCheckedAt !== null,
      complete,
    },
  });
}
