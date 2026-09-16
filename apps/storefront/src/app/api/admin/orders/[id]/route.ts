import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isOrderStatus } from '@/lib/orders/adminOrderWorkflow';
import { loadWorkflowOrder, OrderWorkflowError, updateWorkflowOrder } from '@/lib/orders/orderTransitionService';
import type { PaymentStatus } from '@lepefy/types';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || Array.isArray(body)) return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 });
    const { status, tracking_carrier, tracking_code, notes, payment_status } = body;
    if (status !== undefined && !isOrderStatus(status)) return NextResponse.json({ error: 'Statut invalide.' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ tracking_carrier, tracking_code, notes })) {
      if (value === undefined) continue;
      if (value !== null && typeof value !== 'string') return NextResponse.json({ error: 'Champ invalide.' }, { status: 400 });
      patch[key] = value;
    }
    if (payment_status !== undefined) {
      const valid: PaymentStatus[] = ['pending', 'paid', 'failed', 'refunded'];
      if (!valid.includes(payment_status as PaymentStatus)) return NextResponse.json({ error: 'Statut de paiement invalide.' }, { status: 400 });
      patch.payment_status = payment_status;
    }
    if (status === undefined && Object.keys(patch).length === 0) return NextResponse.json({ error: 'Aucun champ à mettre à jour.' }, { status: 400 });
    const service = createServiceClient();
    const order = await loadWorkflowOrder(service, tenant.id, params.id);
    await updateWorkflowOrder({ service, order, nextStatus: isOrderStatus(status) ? status : undefined, patch });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof OrderWorkflowError) return NextResponse.json({ error: error.message }, { status: error.httpStatus });
    console.error('[admin/orders PATCH] workflow failed');
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }
}
