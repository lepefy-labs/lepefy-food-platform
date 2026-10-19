import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission, getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { OrderWorkflowError } from '@/lib/orders/orderTransitionService';
import { parseOrderIdList } from '@/lib/orders/documents/renderOrderDocuments';
import { startPreparation } from '@/lib/orders/preparation/preparationService';
import { readOrderPreparationSettings, toPreparationMode } from '@/lib/orders/preparation/settings';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/orders/preparation/start { orderIds }
 * « Imprimer et démarrer la préparation » (orders.manage). Idempotent: a retry
 * or a second click changes nothing. The PDF itself stays a plain GET opened
 * by the browser afterwards; it never mutates anything.
 */
export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.manage');
  if (denied) return denied;
  const body = await req.json().catch(() => null) as { orderIds?: unknown } | null;
  const raw = Array.isArray(body?.orderIds) ? (body!.orderIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
  const ids = parseOrderIdList(raw.join(','));
  if (ids.length === 0) return NextResponse.json({ error: 'Aucune commande sélectionnée.' }, { status: 400 });

  const service = createServiceClient();
  const [access, settings] = await Promise.all([getCurrentAdminAccessContext(tenant.id), readOrderPreparationSettings(service, tenant.id)]);
  try {
    const result = await startPreparation({
      service, tenantId: tenant.id, orderIds: ids, actorId: access?.userId ?? null,
      tenantMode: settings.available ? toPreparationMode(settings.config) : null,
    });
    revalidatePath('/admin');
    revalidatePath('/admin/orders');
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OrderWorkflowError) return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    console.error('[admin/orders/preparation/start] failed', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Impossible de démarrer la préparation.' }, { status: 500 });
  }
}
