import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { convertCheckoutSessionToOrder } from '@/lib/orders/convertCheckoutSessionToOrder';
import {
  PAYMENT_IN_PROGRESS_MESSAGE, PAYMENT_UNVERIFIABLE_MESSAGE, releasePendingPaymentIntent,
} from '@/lib/orders/pendingPaymentIntent';
import { cleanOptionalText, normalizeReceivedAt } from '@/lib/orders/assisted/assistedOrderPolicy';

/**
 * Confirmation manuelle d'un paiement externe déclaré (PayPal / Revolut /
 * virement…), pour une session storefront ou une précommande assistée.
 * Protégée par la capability critique `shop_payments.confirm`.
 *
 * Corps optionnel : { receivedAt?, reference?, note? } — tracés sur la commande
 * avec l'identité de l'admin (payment_confirmation_source = admin_verified).
 * Idempotent : deux confirmations simultanées créent une seule commande.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const receivedAt = normalizeReceivedAt(body.receivedAt);
  if (!receivedAt) {
    return NextResponse.json({ error: 'Date d\'encaissement invalide.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);

  const { data: session, error: sessionError } = await supabase
    .from('checkout_sessions')
    .select('id, status, order_id, stripe_payment_intent_id, external_payment_type, external_payment_label')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .in('status', ['open', 'expired', 'awaiting_verification'])
    .is('order_id', null)
    .maybeSingle() as {
      data: {
        id: string;
        stripe_payment_intent_id: string | null;
        external_payment_type: string | null;
        external_payment_label: string | null;
      } | null;
      error: unknown;
    };

  if (sessionError) {
    console.error('[admin/checkout-sessions/confirm-payment] fetch error:', sessionError, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json(
      { error: 'Demande de paiement introuvable ou déjà traitée.' },
      { status: 404 },
    );
  }

  const intent = await releasePendingPaymentIntent(session.stripe_payment_intent_id);
  if (intent === 'blocked') return NextResponse.json({ error: PAYMENT_IN_PROGRESS_MESSAGE }, { status: 409 });
  if (intent === 'unverifiable') return NextResponse.json({ error: PAYMENT_UNVERIFIABLE_MESSAGE }, { status: 503 });

  const result = await convertCheckoutSessionToOrder(supabase, {
    tenantId: tenant.id,
    sessionId: session.id,
    payment: {
      source: 'admin_verified',
      method: 'external_link',
      externalPaymentType: session.external_payment_type,
      externalPaymentLabel: session.external_payment_label,
      receivedAt,
      reference: cleanOptionalText(body.reference, 120),
      note: cleanOptionalText(body.note, 500),
      confirmedBy: admin?.userId ?? null,
    },
  });

  if (!result.ok) {
    if (result.reason === 'session_not_convertible' || result.reason === 'session_not_found') {
      return NextResponse.json({ error: 'Demande de paiement introuvable ou déjà traitée.' }, { status: 409 });
    }
    console.error('[admin/checkout-sessions/confirm-payment] conversion failed:', result.reason, '— session:', params.id);
    return NextResponse.json({ error: 'Erreur lors de la création de la commande.' }, { status: 500 });
  }

  revalidatePath('/admin');
  revalidatePath('/admin/checkout-funnel');

  if (!result.created) {
    // Une confirmation concurrente a gagné : même commande, aucun effet de bord répété.
    return NextResponse.json({ order: result.order, alreadyConfirmed: true });
  }

  if (result.stockConflict) {
    return NextResponse.json({
      order: result.order,
      warning:
        'Commande créée, mais le stock manquait au moment de la confirmation. ' +
        'Aucun remboursement automatique n\'est possible pour ce moyen de paiement — ' +
        'contactez le client et remboursez-le manuellement via PayPal/Revolut.',
    });
  }

  console.info('[admin/checkout-sessions/confirm-payment] Order created — id:', result.order.id, '— session:', params.id);
  return NextResponse.json({ order: result.order, customerNotification: result.customerNotification });
}
