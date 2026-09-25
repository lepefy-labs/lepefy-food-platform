import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { validateCheckoutItems } from '@/lib/checkout/validateCheckoutItems';
import { revalidateSessionShipping } from '@/lib/shipping/tariff/checkoutShipping';
import {
  LINKABLE_PREORDER_STATUSES, computePreorderTotals, payLinkExpiryFromNow, preorderReference,
} from '@/lib/orders/assisted/assistedOrderPolicy';
import { issuePayLinkFields, loadAssistedSession, payUrlFor } from '@/lib/orders/assisted/assistedOrderServer';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';
import {
  PAYMENT_IN_PROGRESS_MESSAGE, PAYMENT_UNVERIFIABLE_MESSAGE, releasePendingPaymentIntent,
} from '@/lib/orders/pendingPaymentIntent';

export const dynamic = 'force-dynamic';

/**
 * Émet (ou réémet) le lien de paiement d'une précommande.
 *
 * Politique : chaque émission vérifie à nouveau disponibilité, règles de
 * quantité et frais de livraison, et applique les prix catalogue courants.
 * Les montants sont ensuite garantis pendant la validité du lien (72 h).
 * L'ancien lien et tout PaymentIntent ouvert sont révoqués.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);
  const session = await loadAssistedSession(supabase, tenant.id, params.id).catch(() => null);
  if (!session) return NextResponse.json({ error: 'Précommande introuvable.' }, { status: 404 });
  if (!LINKABLE_PREORDER_STATUSES.includes(session.status) || session.order_id) {
    return NextResponse.json({ error: 'Aucun lien ne peut être émis pour cette précommande.' }, { status: 409 });
  }
  if (session.shipping_details?.quotePending === true) {
    return NextResponse.json({ error: 'Calculez d\'abord les frais de livraison (modifier la précommande).', code: 'SHIPPING_QUOTE_REQUIRED' }, { status: 409 });
  }

  const intent = await releasePendingPaymentIntent(session.stripe_payment_intent_id);
  if (intent === 'blocked') return NextResponse.json({ error: PAYMENT_IN_PROGRESS_MESSAGE }, { status: 409 });
  if (intent === 'unverifiable') return NextResponse.json({ error: PAYMENT_UNVERIFIABLE_MESSAGE }, { status: 503 });

  const validated = await validateCheckoutItems(supabase, tenant.id, session.items);
  if (validated.ok === false) return NextResponse.json(validated.body, { status: 409 });

  const items = validated.items;
  const subtotal = computePreorderTotals(items, 0, 0).subtotal;
  const shipping = await revalidateSessionShipping({
    supabase,
    tenant,
    fulfillmentType: session.fulfillment_type,
    address: session.shipping_address,
    shippingDetails: session.shipping_details,
    shippingTotal: session.shipping_total ?? 0,
    quantityByProduct: validated.quantityByProduct,
    subtotal,
  });
  if (shipping.ok === false) {
    return NextResponse.json({
      error: 'Les frais de livraison doivent être recalculés : modifiez la précommande avant d\'envoyer un lien.',
      code: shipping.body.code,
    }, { status: 409 });
  }

  const link = issuePayLinkFields(session.id, session.pay_link_version ?? 0);
  if (!link) return NextResponse.json({ error: 'Lien de paiement indisponible : configuration serveur manquante.' }, { status: 500 });

  const previousTotal = computePreorderTotals(session.items ?? [], session.shipping_total, session.ambassador_discount_amount).total;
  const totals = computePreorderTotals(items, session.shipping_total, session.ambassador_discount_amount);
  const now = new Date();
  const expiresAt = payLinkExpiryFromNow(now);

  const { data: updated, error } = await supabase
    .from('checkout_sessions')
    .update({
      ...link.fields,
      items,
      status: 'open',
      payment_method: 'stripe',
      external_payment_type: null,
      external_payment_label: null,
      external_payment_link: null,
      stripe_payment_intent_id: null,
      expires_at: expiresAt,
      updated_at: now.toISOString(),
      last_activity_at: now.toISOString(),
    })
    .eq('id', session.id)
    .eq('tenant_id', tenant.id)
    .eq('origin', 'assisted')
    .in('status', LINKABLE_PREORDER_STATUSES)
    .is('order_id', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[admin/assisted-orders/link] update failed:', error);
    return NextResponse.json({ error: 'Impossible de générer le lien.' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'La précommande a changé entre-temps. Actualisez.' }, { status: 409 });

  if (session.pay_token_hash) {
    await recordAssistedOrderEvent(supabase, {
      tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'link_revoked', actorType: 'admin',
      actorAdminId: admin?.userId ?? null, detail: { reason: 'reissued', version: session.pay_link_version },
    });
  }
  await recordAssistedOrderEvent(supabase, {
    tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'link_issued', actorType: 'admin',
    actorAdminId: admin?.userId ?? null,
    detail: {
      version: (session.pay_link_version ?? 0) + 1,
      expires_at: expiresAt,
      total: totals.total,
      ...(totals.total !== previousTotal ? { previous_total: previousTotal, repriced: true } : {}),
    },
  });

  revalidatePath('/admin');
  return NextResponse.json({
    id: session.id,
    reference: preorderReference(session.id),
    status: 'open',
    payUrl: payUrlFor(tenant, link.token),
    expiresAt,
    total: totals.total,
    repriced: totals.total !== previousTotal,
    previousTotal,
  });
}
