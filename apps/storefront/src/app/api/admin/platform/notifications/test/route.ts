import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getEventsBaseUrl, getTicketUrl } from '@/lib/events/ticketUrl';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';

type TestEvent =
  | 'order-confirmed'
  | 'order-shipped'
  | 'order-ready-for-pickup'
  | 'order-completed'
  | 'order-cancelled'
  | 'order-stock-conflict'
  | 'payment-reminder'
  | 'external-payment-awaiting-verification'
  | 'event-external-payment-awaiting-verification'
  | 'event-reservation-confirmed';

type FulfillmentType = 'delivery' | 'pickup';

const WEBHOOK_PATHS: Record<TestEvent, string> = {
  'order-confirmed': '/webhook/order-confirmed',
  'order-shipped': '/webhook/order-shipped',
  'order-ready-for-pickup': '/webhook/order-ready-for-pickup',
  'order-completed': '/webhook/order-completed',
  'order-cancelled': '/webhook/order-cancelled',
  'order-stock-conflict': '/webhook/order-stock-conflict',
  'payment-reminder': '/webhook/payment-reminder',
  'external-payment-awaiting-verification': '/webhook/external-payment-awaiting-verification',
  'event-external-payment-awaiting-verification': '/webhook/event-external-payment-awaiting-verification',
  'event-reservation-confirmed': '/webhook/event-reservation-confirmed',
};

interface TestRequestBody {
  event?: TestEvent;
  email?: string;
  fullName?: string;
  fulfillmentType?: FulfillmentType;
  total?: number;
  shippingTotal?: number;
  trackingCode?: string;
  trackingCarrier?: string;
  address?: {
    line1?: string;
    line2?: string;
    postal_code?: string;
    city?: string;
    country?: string;
  };
}

function isTestEvent(value: unknown): value is TestEvent {
  return typeof value === 'string' && value in WEBHOOK_PATHS;
}

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function POST(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;

  if (!process.env.N8N_WEBHOOK_URL) {
    return NextResponse.json({ error: 'N8N_WEBHOOK_URL non configuré.' }, { status: 503 });
  }

  let body: TestRequestBody;
  try {
    body = await req.json() as TestRequestBody;
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 });
  }

  if (!isTestEvent(body.event)) {
    return NextResponse.json({ error: 'Événement de test invalide.' }, { status: 400 });
  }
  if (!isEmail(body.email)) {
    return NextResponse.json({ error: 'Adresse email de test invalide.' }, { status: 400 });
  }

  const fulfillmentType: FulfillmentType = body.fulfillmentType === 'pickup' ? 'pickup' : 'delivery';
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const tenantContext = await getTenantNotificationContext(tenant.id);

  if (!tenantContext) {
    return NextResponse.json({ error: 'Contexte de notification du tenant indisponible.' }, { status: 500 });
  }

  const testId = randomUUID();
  const shortId = testId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const orderTrackingLink = tenantContext.storefrontUrl
    ? `${tenantContext.storefrontUrl}/orders/${testId}?token=notification-test`
    : null;
  const total = Number.isFinite(body.total) ? Number(body.total) : 79.9;
  const shippingTotal = Number.isFinite(body.shippingTotal) ? Number(body.shippingTotal) : 8.9;
  const testSentAt = new Date().toISOString();

  const commonPayload: Record<string, unknown> = {
    ...tenantContext,
    testMode: true,
    testSource: 'platform_notification_console',
    testSentAt,
    orderId: testId,
    orderNumber: `#TEST-${shortId}`,
    email: body.email.trim(),
    fullName: body.fullName?.trim() || 'Client test',
    fulfillmentType,
    orderTrackingLink,
  };

  let payload: Record<string, unknown> = commonPayload;

  if (body.event === 'order-confirmed') {
    payload = {
      ...commonPayload,
      total,
      shippingTotal: fulfillmentType === 'delivery' ? shippingTotal : 0,
      shippingAddress: fulfillmentType === 'delivery'
        ? {
            full_name: body.fullName?.trim() || 'Client test',
            line1: body.address?.line1?.trim() || 'Adresse de test',
            line2: body.address?.line2?.trim() || '',
            postal_code: body.address?.postal_code?.trim() || '00000',
            city: body.address?.city?.trim() || tenantContext.business.city || 'Ville test',
            country: body.address?.country?.trim() || tenantContext.business.country,
          }
        : null,
    };
  } else if (body.event === 'order-shipped') {
    payload = {
      ...commonPayload,
      fulfillmentType: 'delivery',
      trackingCode: body.trackingCode?.trim() || 'TEST-TRACKING-001',
      trackingCarrier: body.trackingCarrier?.trim() || 'Transporteur test',
    };
  } else if (body.event === 'order-ready-for-pickup') {
    payload = { ...commonPayload, fulfillmentType: 'pickup' };
  } else if (body.event === 'order-completed') {
    payload = {
      ...commonPayload,
      completionType: fulfillmentType === 'pickup' ? 'picked_up' : 'delivered',
    };
  } else if (body.event === 'order-stock-conflict') {
    payload = {
      ...commonPayload,
      total,
      reason: 'Test console — conflit de stock simulé',
      refundSucceeded: true,
      manualRefundRequired: false,
      adminOrderLink: tenantContext.storefrontUrl
        ? `${tenantContext.storefrontUrl}/admin/orders/${testId}`
        : null,
    };
  } else if (body.event === 'payment-reminder') {
    payload = {
      ...tenantContext,
      testMode: true,
      testSource: 'platform_notification_console',
      testSentAt,
      checkoutSessionId: testId,
      paymentReference: `#TEST-${shortId}`,
      email: body.email.trim(),
      fullName: body.fullName?.trim() || 'Client test',
      paymentMethod: { type: 'paypal', label: 'PayPal' },
      amount: total,
      resumeLink: tenantContext.storefrontUrl
        ? `${tenantContext.storefrontUrl}/checkout/reprendre/${testId}?token=notification-test`
        : null,
      paymentStatus: 'awaiting_verification',
      providerHandoffStarted: true,
      reminderNumber: 1,
      idempotencyKey: `payment-reminder:${testId}:1`,
      reminderSentAt: testSentAt,
    };
  } else if (body.event === 'external-payment-awaiting-verification') {
    payload = {
      ...tenantContext,
      testMode: true,
      testSource: 'platform_notification_console',
      testSentAt,
      notificationType: 'external_payment_awaiting_verification',
      recipients: [body.email.trim()],
      checkoutSessionId: testId,
      paymentReference: `#TEST-${shortId}`,
      customer: {
        fullName: body.fullName?.trim() || 'Client test',
        email: 'client-test@example.com',
        phone: '+33 6 00 00 00 00',
      },
      paymentMethod: { type: 'paypal', label: 'PayPal' },
      amount: total,
      fulfillmentType,
      items: [
        { name: 'Article test', price: Math.max(0, total - (fulfillmentType === 'delivery' ? shippingTotal : 0)), quantity: 1 },
      ],
      shippingAddress: fulfillmentType === 'delivery'
        ? {
            full_name: body.fullName?.trim() || 'Client test',
            line1: body.address?.line1?.trim() || 'Adresse de test',
            line2: body.address?.line2?.trim() || '',
            postal_code: body.address?.postal_code?.trim() || '00000',
            city: body.address?.city?.trim() || tenantContext.business.city || 'Ville test',
            country: body.address?.country?.trim() || tenantContext.business.country,
          }
        : null,
      adminPaymentLink: tenantContext.storefrontUrl
        ? `${tenantContext.storefrontUrl}/admin/paiements-en-attente/${testId}`
        : null,
      createdAt: testSentAt,
      notificationSentAt: testSentAt,
    };
  } else if (body.event === 'event-external-payment-awaiting-verification') {
    const eventsUrl = getEventsBaseUrl().replace(/\/$/, '');
    const eventDateStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const itemPrice = Math.max(0, total / 2);

    payload = {
      ...tenantContext,
      testMode: true,
      testSource: 'platform_notification_console',
      testSentAt,
      eventsUrl,
      notificationType: 'event_external_payment_awaiting_verification',
      recipients: [body.email.trim()],
      requestId: testId,
      paymentReference: `#TEST-${shortId}`,
      event: {
        id: testId,
        title: 'Événement test',
        dateStart: eventDateStart,
        location: tenantContext.business.city || 'Lieu test',
      },
      customer: {
        fullName: body.fullName?.trim() || 'Client test',
        email: 'client-test@example.com',
        phone: '+33 6 00 00 00 00',
      },
      paymentMethod: { type: 'paypal', label: 'PayPal' },
      amount: total,
      currency: 'EUR',
      quantityTotal: 2,
      items: [
        {
          ticketTypeId: `test-${shortId}`,
          name: 'Formule test',
          price: itemPrice,
          quantity: 2,
        },
      ],
      adminPaymentLink: tenantContext.storefrontUrl
        ? `${tenantContext.storefrontUrl.replace(/\/$/, '')}/admin/evenementiel/paiements-en-attente/${testId}`
        : null,
      createdAt: testSentAt,
      notificationSentAt: testSentAt,
    };
  } else if (body.event === 'event-reservation-confirmed') {
    const eventDateStart = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const qrToken = testId.replace(/-/g, '').padEnd(64, '0').slice(0, 64);
    const itemPrice = Math.max(0, total / 2);

    payload = {
      testMode: true,
      testSource: 'platform_notification_console',
      testSentAt,
      reservationId: testId,
      eventId: testId,
      customerName: body.fullName?.trim() || 'Client test',
      customerEmail: body.email.trim(),
      customerPhone: '+33 6 00 00 00 00',
      amountPaid: total,
      source: 'online',
      paymentMethod: 'stripe',
      eventTitle: 'Événement test',
      eventDateStart,
      eventLocation: tenantContext.business.city || 'Lieu test',
      items: [
        {
          reservation_id: testId,
          ticket_type_id: `test-${shortId}`,
          quantity: 2,
          unit_price: itemPrice,
          ticketTypeLabel: 'Formule test',
        },
      ],
      ticketUrl: getTicketUrl(qrToken),
      adminLink: tenantContext.storefrontUrl
        ? `${tenantContext.storefrontUrl.replace(/\/$/, '')}/admin/evenementiel/evenements`
        : null,
    };
  }

  const webhookPath = WEBHOOK_PATHS[body.event];
  const baseUrl = process.env.N8N_WEBHOOK_URL.replace(/\/$/, '');

  try {
    const response = await fetch(`${baseUrl}${webhookPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
    const responseText = (await response.text()).slice(0, 2000);

    return NextResponse.json({
      ok: response.ok,
      event: body.event,
      webhookPath,
      status: response.status,
      response: responseText || null,
      payload,
    }, { status: response.ok ? 200 : 502 });
  } catch (error) {
    console.error('[notification test] n8n request failed:', error);
    return NextResponse.json({
      error: 'Impossible de joindre n8n.',
      event: body.event,
      webhookPath,
      payload,
    }, { status: 502 });
  }
}
