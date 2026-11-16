import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission } from '@/lib/auth/adminRbac';
import { isOrderUuid } from '@/lib/orders/documents/renderOrderDocuments';
import {
  ADDRESS_EDIT_BLOCKER_MESSAGES,
  addressEditBlocker,
  buildEditedShippingAddress,
  providerDraftKeepsOldAddress,
  type AddressEditInput,
  type AddressEditOrderFacts,
} from '@/lib/orders/address/orderAddressEdit';

export const dynamic = 'force-dynamic';

const ORDER_FIELDS = 'id, status, fulfillment_type, tracking_code, shipping_provider_reference, shipping_creation_status, shipping_address, updated_at';

/**
 * POST /api/admin/orders/[id]/address — the team corrects the delivery
 * address of an order (orders.manage). Compare-and-set on `updated_at`: a
 * concurrent change returns 409 instead of being overwritten. Never touches
 * the price, the customer, or the carrier draft/label; the audit trigger
 * records that `shipping_address` changed (without the values).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.manage');
  if (denied) return denied;
  if (!isOrderUuid(params.id)) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body) || !body.address || typeof body.address !== 'object') {
    return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 });
  }
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null;
  if (!expectedUpdatedAt) return NextResponse.json({ error: 'Rechargez la page puis réessayez.' }, { status: 400 });

  const service = createServiceClient();
  const { data: order, error: readError } = await service
    .from('orders').select(ORDER_FIELDS).eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (readError) {
    console.error('[admin/orders/address] read failed', readError.code);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
  if (!order) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });

  const facts = order as AddressEditOrderFacts & { id: string; updated_at: string };
  const blocker = addressEditBlocker(facts);
  if (blocker) return NextResponse.json({ error: ADDRESS_EDIT_BLOCKER_MESSAGES[blocker], code: blocker }, { status: 409 });
  if (facts.updated_at !== expectedUpdatedAt) {
    return NextResponse.json({ error: 'La commande a changé entre-temps. Rechargez la page puis réessayez.', code: 'STALE' }, { status: 409 });
  }

  const result = buildEditedShippingAddress(facts.shipping_address ?? {}, body.address as AddressEditInput);
  if (!result.ok) return NextResponse.json({ error: result.error, field: result.field, code: 'ADDRESS_INVALID' }, { status: 400 });
  if (result.changedFields.length === 0) return NextResponse.json({ ok: true, changed: false, draftKeepsOldAddress: false, postalCodeChanged: false });

  const { data: saved, error: writeError } = await service
    .from('orders')
    .update({ shipping_address: result.address })
    .eq('id', facts.id).eq('tenant_id', tenant.id).eq('updated_at', facts.updated_at)
    .select('id')
    .maybeSingle();
  if (writeError) {
    console.error('[admin/orders/address] write failed', writeError.code);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
  if (!saved) return NextResponse.json({ error: 'La commande a changé entre-temps. Rechargez la page puis réessayez.', code: 'STALE' }, { status: 409 });

  revalidatePath(`/admin/orders/${facts.id}`);
  return NextResponse.json({
    ok: true,
    changed: true,
    draftKeepsOldAddress: providerDraftKeepsOldAddress(facts),
    postalCodeChanged: result.postalCodeChanged,
  });
}
