import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { computePreorderTotals, preorderReference, toCents } from '@/lib/orders/assisted/assistedOrderPolicy';
import { revalidateAssistedSession } from '@/lib/orders/assisted/assistedOrderServer';
import { loadSessionByPayToken } from '@/lib/orders/assisted/payLinkPublic';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * PaymentIntent Stripe d'une précommande (flux différé de StripePaymentStep).
 *
 * Avant toute création/mise à jour : statut payable, disponibilité, règles de
 * quantité et frais de livraison revérifiés côté serveur ; montant calculé à
 * partir de la session (jamais du navigateur). L'intent porte
 * metadata.type = assisted_preorder : seul le webhook convertit en commande.
 */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    const supabase = createServiceClient();
    const session = await loadSessionByPayToken(supabase, tenant.id, params.token);
    if (!session) return NextResponse.json({ error: 'Ce lien de paiement n\'est pas ou plus valide.' }, { status: 404 });
    if (session.status !== 'open' || session.order_id) {
      return NextResponse.json({ error: 'Cette précommande n\'est plus payable.', status: session.status }, { status: 409 });
    }

    const check = await revalidateAssistedSession(supabase, tenant, session);
    if (check.ok === false) {
      return NextResponse.json({
        error: 'Cette précommande doit être mise à jour par le magasin avant le paiement. Contactez-nous.',
        code: check.body.code,
      }, { status: 409 });
    }

    const total = computePreorderTotals(session.items ?? [], session.shipping_total, session.ambassador_discount_amount).total;
    const amount = toCents(total);
    if (amount < 50) return NextResponse.json({ error: 'Montant trop faible pour un paiement par carte.' }, { status: 400 });
    const currency = (tenant.currency ?? 'EUR').toLowerCase();
    const metadata = { type: 'assisted_preorder', session_id: session.id, tenant_id: tenant.id, reference: preorderReference(session.id) };
    const stripe = getStripeClient('shop');

    if (session.stripe_payment_intent_id) {
      try {
        const existing = await stripe.paymentIntents.retrieve(session.stripe_payment_intent_id);
        if (existing.status !== 'canceled' && existing.status !== 'succeeded') {
          const current = existing.amount === amount && existing.currency === currency
            ? existing
            : await stripe.paymentIntents.update(existing.id, { amount, metadata });
          return NextResponse.json({ clientSecret: current.client_secret, referenceId: session.id });
        }
        if (existing.status === 'succeeded') {
          return NextResponse.json({ error: 'Le paiement a déjà été reçu. Confirmation en cours.' }, { status: 409 });
        }
      } catch (retrieveError) {
        console.warn('[pay/intent] existing intent unavailable, creating a new one:', retrieveError);
      }
    }

    const intent = await stripe.paymentIntents.create({
      amount,
      currency,
      automatic_payment_methods: { enabled: true },
      description: `Précommande ${preorderReference(session.id)} — ${tenant.name}`,
      ...(session.email ? { receipt_email: session.email } : {}),
      metadata,
    }, { idempotencyKey: `assisted-pi:${session.id}:v${session.pay_link_version}:${amount}:${session.stripe_payment_intent_id ?? 'none'}` });

    const { error: persistError } = await supabase
      .from('checkout_sessions')
      .update({ stripe_payment_intent_id: intent.id, last_activity_at: new Date().toISOString() })
      .eq('id', session.id)
      .eq('tenant_id', tenant.id)
      .eq('status', 'open')
      .is('order_id', null);
    if (persistError) console.error('[pay/intent] failed to persist intent id:', persistError, '— session:', session.id);

    return NextResponse.json({ clientSecret: intent.client_secret, referenceId: session.id });
  } catch (error) {
    console.error('[pay/intent] unhandled error:', error);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
