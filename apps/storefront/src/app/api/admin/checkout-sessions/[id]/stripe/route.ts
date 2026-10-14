/**
 * GET /api/admin/checkout-sessions/[id]/stripe
 *
 * Lecture seule du PaymentIntent Stripe d'un panier carte de la boutique, pour
 * la fiche admin : statut et motif de refus en français, réseau + 4 derniers
 * chiffres, lien vers le tableau de bord Stripe. Aucune écriture, jamais le
 * client secret. Session vérifiée sur le tenant, permission `orders.view`.
 * Les paiements des tests automatiques (clé de test) sont lus avec la clé de test.
 */
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requirePermission } from '@/lib/auth/adminRbac';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';
import { describeStripeIntent, stripeDashboardUrl, type StripeIntentLike } from '@/lib/payments/cardCartOutcome';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function retrieve(client: Stripe, id: string): Promise<Stripe.PaymentIntent | null> {
  try {
    return await client.paymentIntents.retrieve(id, { expand: ['latest_charge'] });
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') return null;
    throw error;
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const headers = { 'Cache-Control': 'no-store' };
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requirePermission(tenant.id, 'orders.view');
  if (denied) return denied;

  const { data } = await createServiceClient()
    .from('checkout_sessions')
    .select('stripe_payment_intent_id, payment_method')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  const session = data as { stripe_payment_intent_id: string | null; payment_method: string } | null;
  if (!session) return NextResponse.json({ error: 'Panier introuvable.' }, { status: 404, headers });
  if (!session.stripe_payment_intent_id) {
    return NextResponse.json({ found: false, reason: 'no_intent' }, { headers });
  }

  try {
    let testMode = false;
    let intent = await retrieve(getStripeClient('shop'), session.stripe_payment_intent_id);
    if (!intent && process.env.STRIPE_SECRET_KEY_TEST) {
      intent = await retrieve(new Stripe(process.env.STRIPE_SECRET_KEY_TEST), session.stripe_payment_intent_id);
      testMode = Boolean(intent);
    }
    if (!intent) return NextResponse.json({ found: false, reason: 'not_found' }, { headers });
    return NextResponse.json({
      found: true,
      view: describeStripeIntent(intent as unknown as StripeIntentLike),
      dashboardUrl: stripeDashboardUrl(intent.id, testMode || !intent.livemode),
      paymentIntentId: intent.id,
    }, { headers });
  } catch {
    console.error('[admin/stripe] payment intent lookup failed — session:', params.id);
    return NextResponse.json({ error: 'Stripe ne répond pas. Réessayez dans un instant.' }, { status: 502, headers });
  }
}
