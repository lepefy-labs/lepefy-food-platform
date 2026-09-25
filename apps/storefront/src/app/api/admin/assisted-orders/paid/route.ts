import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { MANUAL_PAYMENT_METHOD_LABELS } from '@lepefy/types';
import {
  cleanOptionalText, isManualPaymentMethod, normalizeReceivedAt, payLinkExpiryFromNow, preorderReference,
} from '@/lib/orders/assisted/assistedOrderPolicy';
import { parseAssistedContent, parseRequestKey, sessionContentColumns } from '@/lib/orders/assisted/assistedOrderRequest';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';
import { convertCheckoutSessionToOrder, orderNumberFor } from '@/lib/orders/convertCheckoutSessionToOrder';

export const dynamic = 'force-dynamic';

/**
 * « Déjà payé » : l'encaissement a déjà été reçu par le commerçant (espèces,
 * virement, Postepay…). Le contenu est validé comme toute précommande, la
 * session assistée est créée puis convertie immédiatement par le service
 * central (payment_confirmation_source = admin_recorded). Capability
 * `shop_payments.confirm`. Rejouer la même `requestKey` renvoie la même commande.
 */
export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 });

  const requestKey = parseRequestKey(body.requestKey);
  if (!requestKey) return NextResponse.json({ error: 'Clé de requête manquante.' }, { status: 400 });

  const payment = (body.payment && typeof body.payment === 'object' ? body.payment : {}) as Record<string, unknown>;
  if (!isManualPaymentMethod(payment.method)) {
    return NextResponse.json({ error: 'Choisissez le moyen d\'encaissement.' }, { status: 400 });
  }
  const receivedAt = normalizeReceivedAt(payment.receivedAt);
  if (!receivedAt) return NextResponse.json({ error: 'Date d\'encaissement invalide.' }, { status: 400 });
  const method = payment.method;

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);

  let sessionId: string;
  const existing = await supabase.from('checkout_sessions').select('id')
    .eq('tenant_id', tenant.id).eq('request_key', requestKey).maybeSingle();

  if (existing.data) {
    sessionId = existing.data.id as string;
  } else {
    const parsed = await parseAssistedContent(supabase, tenant, body, { allowPendingShipping: false });
    if (parsed.ok === false) return NextResponse.json(parsed.body, { status: parsed.status });

    const now = new Date();
    sessionId = crypto.randomUUID();
    const { error: insertError } = await supabase.from('checkout_sessions').insert({
      id: sessionId,
      tenant_id: tenant.id,
      ...sessionContentColumns(parsed.content),
      origin: 'assisted',
      created_by_admin_id: admin?.userId ?? null,
      request_key: requestKey,
      notify_customer: body.notifyCustomer === true,
      status: 'open',
      payment_method: 'stripe',
      expires_at: payLinkExpiryFromNow(now),
      last_activity_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (insertError) {
      if ((insertError as { code?: string }).code !== '23505') {
        console.error('[admin/assisted-orders/paid] insert failed:', insertError);
        return NextResponse.json({ error: 'Impossible d\'enregistrer la commande.' }, { status: 500 });
      }
      const winner = await supabase.from('checkout_sessions').select('id')
        .eq('tenant_id', tenant.id).eq('request_key', requestKey).maybeSingle();
      if (!winner.data) return NextResponse.json({ error: 'Impossible d\'enregistrer la commande.' }, { status: 500 });
      sessionId = winner.data.id as string;
    } else {
      await recordAssistedOrderEvent(supabase, {
        tenantId: tenant.id, checkoutSessionId: sessionId, eventType: 'created', actorType: 'admin',
        actorAdminId: admin?.userId ?? null,
        detail: { mode: 'paid', sales_channel: parsed.content.salesChannel, total: parsed.content.cart.total },
      });
    }
  }

  const result = await convertCheckoutSessionToOrder(supabase, {
    tenantId: tenant.id,
    sessionId,
    payment: {
      source: 'admin_recorded',
      method: 'manual',
      externalPaymentType: method,
      externalPaymentLabel: MANUAL_PAYMENT_METHOD_LABELS[method],
      receivedAt,
      reference: cleanOptionalText(payment.reference, 120),
      note: cleanOptionalText(payment.note, 500),
      confirmedBy: admin?.userId ?? null,
    },
  });

  if (!result.ok) {
    if (result.reason === 'session_not_convertible') {
      return NextResponse.json({ error: 'Cette saisie a déjà été traitée autrement (annulée ou payée).' }, { status: 409 });
    }
    console.error('[admin/assisted-orders/paid] conversion failed:', result.reason, '— session:', sessionId);
    return NextResponse.json({ error: 'Erreur lors de la création de la commande.' }, { status: 500 });
  }

  revalidatePath('/admin');
  return NextResponse.json({
    preorderId: sessionId,
    reference: preorderReference(sessionId),
    orderId: result.order.id,
    orderNumber: orderNumberFor(result.order.id),
    created: result.created,
    stockConflict: result.stockConflict,
    customerNotification: result.customerNotification,
    trackingLink: result.trackingLink,
    ...(result.stockConflict ? {
      warning: 'Commande enregistrée mais le stock manquait au moment de la validation : contrôlez-la dans la fiche commande.',
    } : {}),
  }, { status: result.created ? 201 : 200 });
}
