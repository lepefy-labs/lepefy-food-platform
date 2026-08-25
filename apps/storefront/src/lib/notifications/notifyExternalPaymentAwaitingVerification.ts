import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyN8n } from '@/lib/events/notifyN8n';
import { getNotificationRecipients } from '@/lib/notifications/getNotificationRecipients';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';

interface ExternalPaymentItem {
  name: string;
  price: number;
  quantity: number;
}

interface ExternalPaymentSession {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  items: ExternalPaymentItem[];
  shipping_total: number;
  ambassador_discount_amount: number | null;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: Record<string, unknown> | null;
  external_payment_type: string | null;
  external_payment_label: string | null;
  created_at: string;
}

async function releaseClaim(
  supabase: SupabaseClient,
  tenantId: string,
  checkoutSessionId: string,
  claimedAt: string,
) {
  const { error } = await supabase
    .from('checkout_sessions')
    .update({ external_payment_tenant_notified_at: null })
    .eq('id', checkoutSessionId)
    .eq('tenant_id', tenantId)
    .eq('external_payment_tenant_notified_at', claimedAt);

  if (error) {
    console.warn('[external payment tenant notification] claim release failed:', error, '— session:', checkoutSessionId);
  }
}

/**
 * Best-effort internal notification when an external-link purchase intent enters
 * awaiting_verification. A nullable timestamp on checkout_sessions acts as an
 * atomic claim so retries/concurrent requests do not send the same alert twice.
 * Transport/configuration failures release the claim so a later retry can send.
 */
export async function notifyExternalPaymentAwaitingVerification({
  supabase,
  tenantId,
  checkoutSessionId,
}: {
  supabase: SupabaseClient;
  tenantId: string;
  checkoutSessionId: string;
}): Promise<boolean> {
  const claimedAt = new Date().toISOString();

  try {
    const { data: rawSession, error: claimError } = await supabase
      .from('checkout_sessions')
      .update({ external_payment_tenant_notified_at: claimedAt })
      .eq('id', checkoutSessionId)
      .eq('tenant_id', tenantId)
      .eq('status', 'awaiting_verification')
      .eq('payment_method', 'external_link')
      .is('order_id', null)
      .is('external_payment_tenant_notified_at', null)
      .select('id, email, full_name, phone, items, shipping_total, ambassador_discount_amount, fulfillment_type, shipping_address, external_payment_type, external_payment_label, created_at')
      .maybeSingle();

    if (claimError) {
      // This path is intentionally non-blocking. It also keeps deployments safe
      // if application code reaches production before migration 080 is applied.
      console.warn('[external payment tenant notification] claim failed:', claimError, '— session:', checkoutSessionId);
      return false;
    }

    if (!rawSession) return false;

    const session = rawSession as ExternalPaymentSession;
    const recipients = await getNotificationRecipients(
      supabase,
      tenantId,
      'notify_external_payment_pending',
    );

    if (recipients.length === 0) {
      await releaseClaim(supabase, tenantId, checkoutSessionId, claimedAt);
      console.info('[external payment tenant notification] no configured recipients — session:', checkoutSessionId);
      return false;
    }

    const tenantContext = await getTenantNotificationContext(tenantId);
    if (!tenantContext) {
      await releaseClaim(supabase, tenantId, checkoutSessionId, claimedAt);
      console.warn('[external payment tenant notification] tenant context unavailable — tenant:', tenantId);
      return false;
    }

    const subtotal = (session.items ?? []).reduce(
      (sum, item) => sum + Number(item.price) * Number(item.quantity),
      0,
    );
    const amount = Number((
      subtotal
      + Number(session.shipping_total ?? 0)
      - Number(session.ambassador_discount_amount ?? 0)
    ).toFixed(2));

    const adminPaymentLink = tenantContext.storefrontUrl
      ? `${tenantContext.storefrontUrl.replace(/\/$/, '')}/admin/paiements-en-attente/${session.id}`
      : null;

    const delivered = await notifyN8n('/webhook/external-payment-awaiting-verification', {
      ...tenantContext,
      notificationType: 'external_payment_awaiting_verification',
      recipients,
      checkoutSessionId: session.id,
      paymentReference: `#${session.id.slice(0, 8).toUpperCase()}`,
      customer: {
        fullName: session.full_name ?? '',
        email: session.email,
        phone: session.phone,
      },
      paymentMethod: {
        type: session.external_payment_type,
        label: session.external_payment_label ?? session.external_payment_type ?? 'Paiement externe',
      },
      amount,
      fulfillmentType: session.fulfillment_type,
      items: session.items ?? [],
      shippingAddress: session.shipping_address,
      adminPaymentLink,
      createdAt: session.created_at,
      notificationSentAt: claimedAt,
    });

    if (!delivered) {
      await releaseClaim(supabase, tenantId, checkoutSessionId, claimedAt);
      return false;
    }

    return true;
  } catch (error) {
    console.warn('[external payment tenant notification] unexpected failure:', error, '— session:', checkoutSessionId);
    await releaseClaim(supabase, tenantId, checkoutSessionId, claimedAt);
    return false;
  }
}
