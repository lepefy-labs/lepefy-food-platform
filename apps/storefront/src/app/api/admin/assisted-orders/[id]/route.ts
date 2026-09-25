import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import type { AssistedOrderEvent } from '@lepefy/types';
import {
  EDITABLE_PREORDER_STATUSES, allowedPreorderActions, computePreorderTotals, draftExpiryFromNow, preorderReference,
} from '@/lib/orders/assisted/assistedOrderPolicy';
import {
  REVOKED_LINK_FIELDS, currentPayUrl, expireIfDue, loadAssistedSession, shopBaseUrl,
} from '@/lib/orders/assisted/assistedOrderServer';
import { parseAssistedContent, sessionContentColumns } from '@/lib/orders/assisted/assistedOrderRequest';
import { recordAssistedOrderEvent } from '@/lib/orders/assisted/assistedOrderEvents';
import {
  PAYMENT_IN_PROGRESS_MESSAGE, PAYMENT_UNVERIFIABLE_MESSAGE, releasePendingPaymentIntent,
} from '@/lib/orders/pendingPaymentIntent';
import { buildOrderTrackingLink, orderNumberFor } from '@/lib/orders/convertCheckoutSessionToOrder';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const loaded = await loadAssistedSession(supabase, tenant.id, params.id).catch(() => null);
  if (!loaded) return NextResponse.json({ error: 'Précommande introuvable.' }, { status: 404 });
  const session = await expireIfDue(supabase, loaded);

  const [{ data: events }, orderResult, creatorResult] = await Promise.all([
    supabase.from('assisted_order_events')
      .select('id, event_type, actor_type, actor_admin_id, order_id, detail, created_at')
      .eq('tenant_id', tenant.id).eq('checkout_session_id', session.id)
      .order('created_at', { ascending: true }).limit(200),
    session.order_id
      ? supabase.from('orders').select('id, email, status, payment_status').eq('id', session.order_id).eq('tenant_id', tenant.id).maybeSingle()
      : Promise.resolve({ data: null }),
    session.created_by_admin_id
      ? supabase.from('admin_users').select('email').eq('id', session.created_by_admin_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const order = orderResult.data as { id: string; email: string | null; status: string; payment_status: string } | null;
  const payUrl = currentPayUrl(tenant, session);
  const totals = computePreorderTotals(session.items ?? [], session.shipping_total, session.ambassador_discount_amount);

  return NextResponse.json({
    preorder: {
      id: session.id,
      reference: preorderReference(session.id),
      status: session.status,
      salesChannel: session.sales_channel,
      customerId: session.customer_id,
      fullName: session.full_name,
      email: session.email,
      phone: session.phone,
      fulfillmentType: session.fulfillment_type,
      shippingAddress: session.shipping_address,
      shippingPending: session.shipping_details?.quotePending === true,
      items: session.items ?? [],
      totals,
      adminNote: session.admin_note,
      notifyCustomer: session.notify_customer,
      createdAt: session.created_at,
      updatedAt: session.updated_at,
      expiresAt: session.expires_at,
      createdBy: (creatorResult.data as { email: string } | null)?.email ?? null,
      payLinkVersion: session.pay_link_version,
      payLinkIssuedAt: session.pay_token_issued_at,
      payUrl,
      declaredPayment: session.payment_method === 'external_link'
        ? {
            method: session.external_payment_type,
            label: session.external_payment_label,
            declaredAt: session.declared_payment_at,
            reference: session.declared_payment_reference,
          }
        : null,
      order: order
        ? {
            id: order.id,
            number: orderNumberFor(order.id),
            status: order.status,
            paymentStatus: order.payment_status,
            trackingLink: buildOrderTrackingLink(order.id, order.email, shopBaseUrl(tenant)),
          }
        : null,
    },
    actions: allowedPreorderActions(session.status, Boolean(payUrl)),
    events: (events ?? []) as AssistedOrderEvent[],
    tenantName: tenant.name,
    currency: tenant.currency ?? 'EUR',
  });
}

/**
 * Modification du contenu (articles, livraison, client, canal). Autorisée
 * seulement avant paiement (brouillon, lien ouvert ou expiré). Le lien
 * éventuellement partagé est révoqué et l'intent Stripe annulé : la précommande
 * redevient un brouillon et un nouveau lien doit être émis explicitement.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body)) return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 });

  const supabase = createServiceClient();
  const admin = await getCurrentAdminAccessContext(tenant.id);
  const session = await loadAssistedSession(supabase, tenant.id, params.id).catch(() => null);
  if (!session) return NextResponse.json({ error: 'Précommande introuvable.' }, { status: 404 });
  if (!EDITABLE_PREORDER_STATUSES.includes(session.status) || session.order_id) {
    return NextResponse.json({ error: 'Cette précommande ne peut plus être modifiée.' }, { status: 409 });
  }

  const intent = await releasePendingPaymentIntent(session.stripe_payment_intent_id);
  if (intent === 'blocked') return NextResponse.json({ error: PAYMENT_IN_PROGRESS_MESSAGE }, { status: 409 });
  if (intent === 'unverifiable') return NextResponse.json({ error: PAYMENT_UNVERIFIABLE_MESSAGE }, { status: 503 });

  const parsed = await parseAssistedContent(supabase, tenant, body, { allowPendingShipping: true });
  if (parsed.ok === false) return NextResponse.json(parsed.body, { status: parsed.status });

  const nowIso = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from('checkout_sessions')
    .update({
      ...sessionContentColumns(parsed.content),
      ...REVOKED_LINK_FIELDS,
      status: 'draft',
      stripe_payment_intent_id: null,
      expires_at: draftExpiryFromNow(),
      updated_at: nowIso,
      last_activity_at: nowIso,
    })
    .eq('id', session.id)
    .eq('tenant_id', tenant.id)
    .eq('origin', 'assisted')
    .in('status', EDITABLE_PREORDER_STATUSES)
    .is('order_id', null)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[admin/assisted-orders PATCH] update failed:', error);
    return NextResponse.json({ error: 'Impossible d\'enregistrer les modifications.' }, { status: 500 });
  }
  if (!updated) return NextResponse.json({ error: 'La précommande a changé entre-temps. Actualisez.' }, { status: 409 });

  const previousTotal = computePreorderTotals(session.items ?? [], session.shipping_total, session.ambassador_discount_amount).total;
  await recordAssistedOrderEvent(supabase, {
    tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'updated', actorType: 'admin', actorAdminId: admin?.userId ?? null,
    detail: { previous_total: previousTotal, total: parsed.content.cart.total, previous_status: session.status },
  });
  if (session.pay_token_hash) {
    await recordAssistedOrderEvent(supabase, {
      tenantId: tenant.id, checkoutSessionId: session.id, eventType: 'link_revoked', actorType: 'admin', actorAdminId: admin?.userId ?? null,
      detail: { reason: 'content_updated', version: session.pay_link_version },
    });
  }

  revalidatePath('/admin');
  return NextResponse.json({ id: session.id, status: 'draft', total: parsed.content.cart.total, linkRevoked: Boolean(session.pay_token_hash) });
}
