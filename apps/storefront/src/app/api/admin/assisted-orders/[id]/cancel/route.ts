import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { CANCELLABLE_PREORDER_STATUSES, cleanOptionalText } from '@/lib/orders/assisted/assistedOrderPolicy';
import { loadAssistedSession } from '@/lib/orders/assisted/assistedOrderServer';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';
import {
  PAYMENT_IN_PROGRESS_MESSAGE, PAYMENT_UNVERIFIABLE_MESSAGE, releasePendingPaymentIntent,
} from '@/lib/orders/pendingPaymentIntent';

/** Annulation d'une précommande non payée : intent Stripe annulé, aucune commande ; le lien affiche « Annulée ». */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);
  const session = await loadAssistedSession(supabase, tenant.id, params.id).catch(() => null);
  if (!session) return NextResponse.json({ error: 'Précommande introuvable.' }, { status: 404 });
  if (!CANCELLABLE_PREORDER_STATUSES.includes(session.status) || session.order_id) {
    return NextResponse.json({ error: 'Cette précommande ne peut plus être annulée.' }, { status: 409 });
  }

  const intent = await releasePendingPaymentIntent(session.stripe_payment_intent_id);
  if (intent === 'blocked') return NextResponse.json({ error: PAYMENT_IN_PROGRESS_MESSAGE }, { status: 409 });
  if (intent === 'unverifiable') return NextResponse.json({ error: PAYMENT_UNVERIFIABLE_MESSAGE }, { status: 503 });

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('checkout_sessions')
    .update({ status: 'cancelled', updated_at: nowIso, last_activity_at: nowIso })
    .eq('id', session.id)
    .eq('tenant_id', tenant.id)
    .eq('origin', 'assisted')
    .in('status', CANCELLABLE_PREORDER_STATUSES)
    .is('order_id', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[admin/assisted-orders/cancel] update failed:', error);
    return NextResponse.json({ error: 'Impossible d\'annuler la précommande.' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'La précommande a changé entre-temps. Actualisez.' }, { status: 409 });

  await recordAssistedOrderEvent(supabase, {
    tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'cancelled', actorType: 'admin',
    actorAdminId: admin?.userId ?? null,
    detail: { previous_status: session.status, reason: cleanOptionalText(body.reason, 300) },
  });

  revalidatePath('/admin');
  return NextResponse.json({ id: session.id, status: 'cancelled' });
}
