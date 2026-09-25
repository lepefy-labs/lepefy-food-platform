import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { MANUAL_PAYMENT_METHOD_LABELS } from '@lepefy/types';
import { cleanOptionalText, isManualPaymentMethod, normalizeReceivedAt } from '@/lib/orders/assisted/assistedOrderPolicy';
import { loadAssistedSession, revalidateAssistedSession } from '@/lib/orders/assisted/assistedOrderServer';
import { convertCheckoutSessionToOrder, orderNumberFor } from '@/lib/orders/convertCheckoutSessionToOrder';
import {
  PAYMENT_IN_PROGRESS_MESSAGE, PAYMENT_UNVERIFIABLE_MESSAGE, releasePendingPaymentIntent,
} from '@/lib/orders/pendingPaymentIntent';

/**
 * Confirme l'encaissement d'une précommande (capability `shop_payments.confirm`).
 *
 * - `awaiting_verification` : paiement déclaré (par le client ou l'équipe),
 *   vérifié par l'admin → admin_verified, moyen déclaré conservé.
 * - `draft` / `open` : encaissement reçu hors lien (ex. espèces au retrait)
 *   → admin_recorded avec le moyen choisi ; disponibilité revérifiée avant.
 *
 * Corps : { method?, receivedAt?, reference?, note?, notifyCustomer? }.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const receivedAt = normalizeReceivedAt(body.receivedAt);
  if (!receivedAt) return NextResponse.json({ error: 'Date d\'encaissement invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);
  const session = await loadAssistedSession(supabase, tenant.id, params.id).catch(() => null);
  if (!session) return NextResponse.json({ error: 'Précommande introuvable.' }, { status: 404 });
  if (session.order_id || !['draft', 'open', 'awaiting_verification'].includes(session.status)) {
    return NextResponse.json({ error: 'Cette précommande est déjà traitée ou n\'est plus payable.' }, { status: 409 });
  }

  const verifying = session.status === 'awaiting_verification';
  const method = verifying ? session.external_payment_type : body.method;
  if (!verifying && !isManualPaymentMethod(method)) {
    return NextResponse.json({ error: 'Choisissez le moyen d\'encaissement.' }, { status: 400 });
  }

  const intent = await releasePendingPaymentIntent(session.stripe_payment_intent_id);
  if (intent === 'blocked') return NextResponse.json({ error: PAYMENT_IN_PROGRESS_MESSAGE }, { status: 409 });
  if (intent === 'unverifiable') return NextResponse.json({ error: PAYMENT_UNVERIFIABLE_MESSAGE }, { status: 503 });

  // Un encaissement enregistré sans vérification préalable doit porter sur un
  // panier encore honorable ; un paiement déjà déclaré par le client est
  // confirmé comme le flux historique (conflit de stock tracé si nécessaire).
  if (!verifying) {
    const check = await revalidateAssistedSession(supabase, tenant, session);
    if (check.ok === false) return NextResponse.json(check.body, { status: check.status });
  }

  if (typeof body.notifyCustomer === 'boolean' && body.notifyCustomer !== session.notify_customer) {
    await supabase.from('checkout_sessions').update({ notify_customer: body.notifyCustomer })
      .eq('id', session.id).eq('tenant_id', tenant.id).is('order_id', null);
  }

  const label = verifying
    ? session.external_payment_label
    : MANUAL_PAYMENT_METHOD_LABELS[method as keyof typeof MANUAL_PAYMENT_METHOD_LABELS];

  const result = await convertCheckoutSessionToOrder(supabase, {
    tenantId: tenant.id,
    sessionId: session.id,
    payment: {
      source: verifying ? 'admin_verified' : 'admin_recorded',
      method: verifying ? 'external_link' : 'manual',
      externalPaymentType: typeof method === 'string' ? method : null,
      externalPaymentLabel: label,
      receivedAt,
      reference: cleanOptionalText(body.reference, 120) ?? session.declared_payment_reference,
      note: cleanOptionalText(body.note, 500),
      confirmedBy: admin?.userId ?? null,
    },
    notifyCustomer: typeof body.notifyCustomer === 'boolean' ? body.notifyCustomer : undefined,
  });

  if (!result.ok) {
    if (result.reason === 'session_not_convertible' || result.reason === 'session_not_found') {
      return NextResponse.json({ error: 'Cette précommande est déjà traitée ou n\'est plus payable.' }, { status: 409 });
    }
    console.error('[admin/assisted-orders/confirm-payment] conversion failed:', result.reason, '— session:', session.id);
    return NextResponse.json({ error: 'Erreur lors de la création de la commande.' }, { status: 500 });
  }

  revalidatePath('/admin');
  return NextResponse.json({
    orderId: result.order.id,
    orderNumber: orderNumberFor(result.order.id),
    created: result.created,
    stockConflict: result.stockConflict,
    customerNotification: result.customerNotification,
    trackingLink: result.trackingLink,
    ...(result.stockConflict ? {
      warning: 'Commande créée mais le stock manquait : contactez le client et remboursez-le manuellement si nécessaire.',
    } : {}),
  });
}
