import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { payLinkExpiryFromNow } from '@/lib/orders/assisted/assistedOrderPolicy';
import { loadAssistedSession } from '@/lib/orders/assisted/assistedOrderServer';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';

/**
 * Paiement déclaré non reçu : la précommande revient « En attente de paiement »
 * (lifecycle existant awaiting_verification → open). Le moyen déclaré est
 * effacé ; si un lien était actif il redevient payable par carte.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);
  const session = await loadAssistedSession(supabase, tenant.id, params.id).catch(() => null);
  if (!session) return NextResponse.json({ error: 'Précommande introuvable.' }, { status: 404 });
  if (session.status !== 'awaiting_verification' || session.order_id) {
    return NextResponse.json({ error: 'Seul un paiement à vérifier peut être remis en attente.' }, { status: 409 });
  }

  const now = new Date();
  // payment_method et external_payment_link sont remis à zéro dans la même
  // écriture : le trigger 075 ne repasse donc pas la ligne en awaiting_verification.
  const { data: updated, error } = await supabase
    .from('checkout_sessions')
    .update({
      status: 'open',
      payment_method: 'stripe',
      external_payment_type: null,
      external_payment_label: null,
      external_payment_link: null,
      declared_payment_at: null,
      declared_payment_reference: null,
      external_payment_tenant_notified_at: null,
      expires_at: payLinkExpiryFromNow(now),
      updated_at: now.toISOString(),
      last_activity_at: now.toISOString(),
    })
    .eq('id', session.id)
    .eq('tenant_id', tenant.id)
    .eq('origin', 'assisted')
    .eq('status', 'awaiting_verification')
    .is('order_id', null)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[admin/assisted-orders/reopen] update failed:', error);
    return NextResponse.json({ error: 'Impossible de remettre la précommande en attente.' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'La précommande a changé entre-temps. Actualisez.' }, { status: 409 });

  await recordAssistedOrderEvent(supabase, {
    tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'reopened', actorType: 'admin',
    actorAdminId: admin?.userId ?? null,
    detail: { declared_method: session.external_payment_type },
  });

  revalidatePath('/admin');
  return NextResponse.json({ id: session.id, status: 'open' });
}
