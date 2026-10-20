import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { OrderWorkflowError } from '@/lib/orders/orderTransitionService';
import { isOrderUuid } from '@/lib/orders/documents/renderOrderDocuments';
import { CLOSURE_NOTIFICATIONS, CLOSURE_REASONS } from '@/lib/orders/closure/closureRules';
import { closeOrder, OrderClosureError } from '@/lib/orders/closure/orderClosureService';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  reason: z.enum(CLOSURE_REASONS),
  notification: z.enum(CLOSURE_NOTIFICATIONS),
  message: z.string().max(2000).nullish(),
  note: z.string().max(1000).nullish(),
  shipmentAcknowledged: z.boolean().optional(),
}).strict();

/**
 * POST /api/admin/orders/[id]/close — cancel or close an order handled outside
 * the platform (orders.manage). Idempotent: repeating the same closure returns
 * the recorded one. Never touches payment, refunds or the carrier.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.manage');
  if (denied) return denied;
  if (!isOrderUuid(params.id)) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Choisissez un motif et la communication au client.' }, { status: 400 });

  try {
    const access = await getCurrentAdminAccessContext(tenant.id);
    const result = await closeOrder({ ...parsed.data, service: createServiceClient(), tenantId: tenant.id, orderId: params.id, actorId: access?.userId ?? null });
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    return NextResponse.json({
      ok: true, closureType: result.closureType, alreadyClosed: result.alreadyClosed, customerNotified: result.customerNotified,
    });
  } catch (error) {
    if (error instanceof OrderClosureError) return NextResponse.json({ error: error.message, issues: error.issues }, { status: error.httpStatus });
    if (error instanceof OrderWorkflowError) {
      const message = error.httpStatus === 503 ? 'Clôture impossible pour le moment (la migration 161 est-elle appliquée ?). Réessayez.' : error.message;
      return NextResponse.json({ error: message }, { status: error.httpStatus });
    }
    console.error('[admin/orders/close] failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Clôture impossible.' }, { status: 500 });
  }
}
