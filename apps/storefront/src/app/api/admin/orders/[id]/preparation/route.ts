import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { OrderWorkflowError } from '@/lib/orders/orderTransitionService';
import { isOrderUuid } from '@/lib/orders/documents/renderOrderDocuments';
import { completePaperPreparation, withdrawPaperPreparation } from '@/lib/orders/preparation/preparationService';

export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  if (error instanceof OrderWorkflowError) return NextResponse.json({ error: error.message }, { status: error.httpStatus });
  console.error('[admin/orders/preparation] failed', error instanceof Error ? error.message : error);
  return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
}

/**
 * POST — « Préparation terminée » (paper mode): { allPrepared: true, parcelCount?, coldDeclared? }.
 * DELETE — withdraws the declaration while the order is still in preparation.
 * orders.manage; idempotent; never sets the digital checks.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.manage');
  if (denied) return denied;
  if (!isOrderUuid(params.id)) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  const body = await req.json().catch(() => null) as { allPrepared?: unknown; parcelCount?: unknown; coldDeclared?: unknown } | null;
  try {
    const access = await getCurrentAdminAccessContext(tenant.id);
    const order = await completePaperPreparation({
      service: createServiceClient(), tenantId: tenant.id, orderId: params.id, actorId: access?.userId ?? null,
      allPrepared: body?.allPrepared === true,
      parcelCount: typeof body?.parcelCount === 'number' ? body.parcelCount : null,
      coldDeclared: body?.coldDeclared === true,
    });
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    return NextResponse.json({ ok: true, paperPreparationCompletedAt: order.paper_preparation_completed_at ?? null, parcelCount: order.packing_parcel_count });
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.manage');
  if (denied) return denied;
  if (!isOrderUuid(params.id)) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  try {
    await withdrawPaperPreparation({ service: createServiceClient(), tenantId: tenant.id, orderId: params.id });
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
