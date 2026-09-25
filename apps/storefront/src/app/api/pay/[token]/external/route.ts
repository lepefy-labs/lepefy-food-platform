import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { cleanOptionalText, computePreorderTotals } from '@/lib/orders/assisted/assistedOrderPolicy';
import { revalidateAssistedSession } from '@/lib/orders/assisted/assistedOrderServer';
import { externalPaymentLink, loadSessionByPayToken, publicExternalMethods } from '@/lib/orders/assisted/payLinkPublic';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';
import { notifyExternalPaymentAwaitingVerification } from '@/lib/notifications/notifyExternalPaymentAwaitingVerification';
import {
  PAYMENT_IN_PROGRESS_MESSAGE, PAYMENT_UNVERIFIABLE_MESSAGE, releasePendingPaymentIntent,
} from '@/lib/orders/pendingPaymentIntent';

export const dynamic = 'force-dynamic';

/**
 * Le client choisit un moyen externe (PayPal, Revolut, virement…). Ce n'est
 * PAS une confirmation d'encaissement : la précommande passe « Paiement à
 * vérifier » et seule une confirmation admin tracée créera la commande.
 * Corps : { methodId, reference? }.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.methodId !== 'string') return NextResponse.json({ error: 'Moyen de paiement invalide.' }, { status: 400 });

    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createServiceClient();
    const session = await loadSessionByPayToken(supabase, tenant.id, params.token);
    if (!session) return NextResponse.json({ error: 'Ce lien de paiement n\'est pas ou plus valide.' }, { status: 404 });
    if (session.status !== 'open' || session.order_id) {
      return NextResponse.json({ error: 'Cette précommande n\'est plus payable.', status: session.status }, { status: 409 });
    }

    const methods = await getTenantPaymentMethods(tenant.id);
    const allowed = publicExternalMethods(methods).find((method) => method.id === body.methodId);
    const method = allowed ? methods.find((row) => row.id === allowed.id) : null;
    if (!allowed || !method) return NextResponse.json({ error: 'Moyen de paiement indisponible.' }, { status: 400 });

    const check = await revalidateAssistedSession(supabase, tenant, session);
    if (check.ok === false) {
      return NextResponse.json({ error: 'Cette précommande doit être mise à jour par le magasin avant le paiement. Contactez-nous.' }, { status: 409 });
    }

    // Plus de paiement carte possible une fois un moyen externe choisi.
    const intent = await releasePendingPaymentIntent(session.stripe_payment_intent_id);
    if (intent === 'blocked') return NextResponse.json({ error: PAYMENT_IN_PROGRESS_MESSAGE }, { status: 409 });
    if (intent === 'unverifiable') return NextResponse.json({ error: PAYMENT_UNVERIFIABLE_MESSAGE }, { status: 503 });

    const total = computePreorderTotals(session.items ?? [], session.shipping_total, session.ambassador_discount_amount).total;
    const link = externalPaymentLink(method, total, tenant.currency ?? 'EUR');
    const nowIso = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from('checkout_sessions')
      .update({
        status: 'awaiting_verification',
        payment_method: 'external_link',
        external_payment_type: method.method,
        external_payment_label: allowed.label,
        external_payment_link: link,
        declared_payment_at: nowIso,
        declared_payment_reference: cleanOptionalText(body.reference, 120),
        stripe_payment_intent_id: null,
        updated_at: nowIso,
        last_activity_at: nowIso,
      })
      .eq('id', session.id)
      .eq('tenant_id', tenant.id)
      .eq('origin', 'assisted')
      .eq('status', 'open')
      .is('order_id', null)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[pay/external] update failed:', error);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }
    if (!updated) return NextResponse.json({ error: 'Cette précommande n\'est plus payable.' }, { status: 409 });

    await recordAssistedOrderEvent(supabase, {
      tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'payment_declared', actorType: 'customer',
      detail: { method: method.method, label: allowed.label },
    });
    // Alerte interne existante (claim idempotent) : « paiement externe à vérifier ».
    await notifyExternalPaymentAwaitingVerification({ supabase, tenantId: tenant.id, checkoutSessionId: session.id });

    return NextResponse.json({ status: 'awaiting_verification', link });
  } catch (error) {
    console.error('[pay/external] unhandled error:', error);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
