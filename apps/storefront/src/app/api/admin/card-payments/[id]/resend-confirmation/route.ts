import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { cardQuickPaymentCustomerEmail } from '@/lib/notifications/customerEmails';
import { sendTenantEmail } from '@/lib/notifications/sendEmail';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Admin → Paiements carte: resend the customer confirmation (orders.manage).
// Only for a paid payment with an email; the recipient is always the stored
// customer_email, never a value from the request.
export const dynamic = 'force-dynamic';

const idSchema = z.string().uuid();

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === request.nextUrl.host; } catch { return false; }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const authError = await requireAdmin(tenant.id);
  if (authError) return authError;
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Requête refusée.' }, { status: 403 });
  if (!idSchema.safeParse(params.id).success) return NextResponse.json({ error: 'Identifiant invalide.' }, { status: 400 });

  const { data: payment } = await createServiceClient()
    .from('tenant_card_payments')
    .select('id, tenant_id, amount, currency, customer_name, customer_email, stripe_payment_intent_id, status, paid_at')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!payment) return NextResponse.json({ error: 'Paiement introuvable.' }, { status: 404 });
  if (payment.status !== 'paid') return NextResponse.json({ error: 'Seul un paiement confirmé peut être renvoyé.' }, { status: 409 });
  const email = payment.customer_email?.trim();
  if (!email) return NextResponse.json({ error: 'Aucune adresse email pour ce paiement.' }, { status: 409 });

  const sent = await sendTenantEmail({
    tenantId: tenant.id,
    notificationType: 'card_quick_payment_customer',
    // Each manual resend is its own message (the automatic one keeps card-quick-payment-customer:<pi>).
    idempotencyKey: `card-quick-payment-customer:${payment.stripe_payment_intent_id ?? payment.id}:resend:${randomUUID()}`,
    recipients: [email],
    render: (context) => cardQuickPaymentCustomerEmail(context, {
      quickPaymentId: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      customerName: payment.customer_name,
      paidAt: payment.paid_at ?? new Date().toISOString(),
    }),
  });
  console.info('[admin/card-payments] confirmation resent — payment:', payment.id, '— accepted:', sent);
  // Not accepted now: the delivery ledger retries it, so a second click would duplicate it.
  if (!sent) return NextResponse.json({ error: 'Envoi non confirmé : une nouvelle tentative automatique est prévue. Vérifiez l’historique des notifications avant de renvoyer.' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
