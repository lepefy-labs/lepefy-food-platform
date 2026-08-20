import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getStripeClient } from '@/lib/payments/stripeServerConfig';

const stripe = getStripeClient('card');

// Route publique — pas de requireAdmin : le client scanne le QR sur /card et
// paie sans compte. Aucun panier/produit derrière, montant saisi librement
// (min/max ci-dessous), donc toute la validation se fait ici, jamais côté
// client.
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 2000;

interface QuickPayBody {
  amount:         number;
  customerName?:  string | null;
  customerEmail?: string | null;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function POST(req: NextRequest) {
  try {
    const body: QuickPayBody = await req.json();
    const { amount, customerName, customerEmail } = body;

    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return NextResponse.json(
        { error: `Le montant doit être compris entre ${MIN_AMOUNT} et ${MAX_AMOUNT}.` },
        { status: 400 },
      );
    }

    if (customerEmail && !isValidEmail(customerEmail)) {
      return NextResponse.json({ error: 'Email invalide.' }, { status: 400 });
    }

    const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
    const tenant = await getTenant(slug);

    const roundedAmount = Math.round(amount * 100) / 100;
    const supabase      = createServiceClient();

    const { data: row, error: insertError } = await supabase
      .from('tenant_card_payments')
      .insert({
        tenant_id:      tenant.id,
        amount:         roundedAmount,
        currency:       tenant.currency ?? 'eur',
        customer_name:  customerName?.trim() || null,
        customer_email: customerEmail?.trim() || null,
      })
      .select('id')
      .single();

    if (insertError || !row) {
      console.error('[card/quick-pay] insert error:', insertError);
      return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(roundedAmount * 100),
      currency: tenant.currency ?? 'eur',
      // Voir api/checkout/route.ts — RAPPEL : Link à désactiver manuellement
      // depuis Stripe Dashboard (Settings → Payment Methods → Link).
      automatic_payment_methods: { enabled: true },
      metadata: {
        type:             'card_quick_payment',
        tenant_id:        tenant.id,
        quick_payment_id: row.id,
      },
    });

    const { error: updateError } = await supabase
      .from('tenant_card_payments')
      .update({ stripe_payment_intent_id: paymentIntent.id })
      .eq('id', row.id);

    if (updateError) {
      console.error('[card/quick-pay] failed to store payment_intent_id:', updateError, '— row:', row.id);
    }

    console.info('[card/quick-pay] PaymentIntent created — id:', paymentIntent.id, '— amount:', paymentIntent.amount);

    await supabase.from('payment_funnel_logs').insert({
      tenant_id:    tenant.id,
      module:       'card',
      event_type:   'intent_created',
      reference_id: row.id,
      detail:       { amount: roundedAmount },
    });

    return NextResponse.json({ clientSecret: paymentIntent.client_secret, quickPaymentId: row.id });
  } catch (err) {
    console.error('[card/quick-pay] unhandled error:', err);
    return NextResponse.json({ error: 'Erreur serveur. Veuillez réessayer.' }, { status: 500 });
  }
}
