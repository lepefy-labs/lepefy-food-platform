import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getEventsBaseUrl, getTicketUrl } from '@/lib/events/ticketUrl';
import { getTenant } from '@/lib/tenant/getTenant';
import { androidAppState, getTenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import { n8nWebhookHeaders, n8nWebhookUrl, sendNotification } from '@/lib/events/notifyN8n';
import { RENDERED_EMAIL_WEBHOOKS } from '@/lib/notifications/emailTransport';
import { buildOrderStockConflictNotification } from '@/lib/notifications/orderStockConflictEmail';
import { emailRequest, SEND_EMAIL_WEBHOOK, type RenderedEmail } from '@/lib/notifications/sendEmail';
import {
  eventExternalPaymentAwaitingVerificationEmail, eventReservationConfirmedEmail, externalPaymentAwaitingVerificationEmail,
  orderCancelledEmail, orderCompletedEmail, orderConfirmedEmail, orderReadyForPickupEmail, orderShippedEmail,
  cardQuickPaymentCustomerEmail, paymentReminderEmail, PLATFORM_EMAIL_CONTEXT, reviewInviteEmail, type ShippingAddressLike,
} from '@/lib/notifications/customerEmails';
import type { TenantNotificationContext } from '@/lib/notifications/getTenantNotificationContext';
import {
  buildTesterFeedbackInviteEmail,
  LEPEFY_PLATFORM_SIGNATURE,
  LEPEFY_PLATFORM_TAGLINE,
  TESTER_FEEDBACK_INVITE_WEBHOOK,
} from '@/lib/notifications/testerFeedbackInviteEmail';

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
  | 'event-reservation-confirmed'
  | 'review-invite'
  | 'tester-feedback-invite'
  | 'card-quick-payment-customer'
  | 'card-quick-payment-customer-app-live';

type FulfillmentType = 'delivery' | 'pickup';
type ReviewInviteKind = 'initial' | 'reminder';

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
  'review-invite': '/webhook/review-invite',
  'tester-feedback-invite': TESTER_FEEDBACK_INVITE_WEBHOOK,
  'card-quick-payment-customer': SEND_EMAIL_WEBHOOK,
  'card-quick-payment-customer-app-live': SEND_EMAIL_WEBHOOK,
};

interface TestRequestBody {
  event?: TestEvent;
  email?: string;
  fullName?: string;
  fulfillmentType?: FulfillmentType;
  reviewInviteKind?: ReviewInviteKind;
  total?: number;
  shippingTotal?: number;
  trackingCode?: string;
  trackingCarrier?: string;
  googlePlayTestUrl?: string;
  address?: {
    line1?: string;
    line2?: string;
    postal_code?: string;
    city?: string;
    country?: string;
  };
}

/** Test payloads of the events migrated to in-app templates, rendered with the production builders. */
function renderInAppTestEmail(
  event: TestEvent,
  context: TenantNotificationContext,
  payload: Record<string, unknown>,
): RenderedEmail | null {
  const p = payload;
  const order = {
    orderNumber: String(p.orderNumber ?? ''),
    fullName: (p.fullName as string | undefined) ?? null,
    orderTrackingLink: (p.orderTrackingLink as string | null | undefined) ?? null,
    testMode: true,
  };
  switch (event) {
    case 'order-confirmed':
      return orderConfirmedEmail(context, {
        ...order, fulfillmentType: (p.fulfillmentType as string | undefined) ?? null, total: Number(p.total ?? 0),
        shippingTotal: Number(p.shippingTotal ?? 0), shippingAddress: (p.shippingAddress as ShippingAddressLike | null) ?? null,
      });
    case 'order-shipped':
      return orderShippedEmail(context, {
        ...order, trackingCode: (p.trackingCode as string | undefined) ?? null, trackingCarrier: (p.trackingCarrier as string | undefined) ?? null,
      });
    case 'order-ready-for-pickup':
      return orderReadyForPickupEmail(context, order);
    case 'order-completed':
      return orderCompletedEmail(context, { ...order, completionType: p.completionType === 'picked_up' ? 'picked_up' : 'delivered' });
    case 'order-cancelled':
      return orderCancelledEmail(context, order);
    case 'payment-reminder':
      return paymentReminderEmail(context, {
        paymentReference: String(p.paymentReference ?? ''), fullName: order.fullName,
        paymentMethodLabel: (p.paymentMethod as { label?: string } | undefined)?.label ?? 'Paiement externe',
        amount: Number(p.amount ?? 0), providerHandoffStarted: p.providerHandoffStarted === true,
        resumeLink: String(p.resumeLink ?? ''), testMode: true,
      });
    case 'external-payment-awaiting-verification': {
      const customer = (p.customer ?? {}) as { fullName?: string; email?: string; phone?: string };
      return externalPaymentAwaitingVerificationEmail(context, {
        paymentReference: String(p.paymentReference ?? ''),
        paymentMethodLabel: (p.paymentMethod as { label?: string } | undefined)?.label ?? 'Paiement externe',
        amount: Number(p.amount ?? 0), fulfillmentType: (p.fulfillmentType as string | undefined) ?? null,
        customer: { fullName: customer.fullName ?? null, email: customer.email ?? null, phone: customer.phone ?? null },
        items: (p.items as Array<{ name: string; price: number; quantity: number }> | undefined) ?? [],
        adminPaymentLink: (p.adminPaymentLink as string | null | undefined) ?? null, testMode: true,
      });
    }
    case 'event-external-payment-awaiting-verification': {
      const customer = (p.customer ?? {}) as { fullName?: string; email?: string; phone?: string };
      const event = (p.event ?? {}) as { title?: string; dateStart?: string; location?: string | null };
      return eventExternalPaymentAwaitingVerificationEmail(context, {
        event: { title: event.title ?? 'Événement test', dateStart: event.dateStart ?? null, location: event.location ?? null },
        paymentReference: String(p.paymentReference ?? ''),
        paymentMethodLabel: (p.paymentMethod as { label?: string } | undefined)?.label ?? 'Paiement externe',
        amount: Number(p.amount ?? 0), quantityTotal: Number(p.quantityTotal ?? 0),
        customer: { fullName: customer.fullName ?? null, email: customer.email ?? null, phone: customer.phone ?? null },
        items: (p.items as Array<{ name: string; price: number; quantity: number }> | undefined) ?? [],
        adminPaymentLink: (p.adminPaymentLink as string | null | undefined) ?? null,
        eventsUrl: (p.eventsUrl as string | undefined) ?? null, testMode: true,
      });
    }
    case 'event-reservation-confirmed':
      return eventReservationConfirmedEmail(context, {
        customerName: (p.customerName as string | undefined) ?? null,
        eventTitle: (p.eventTitle as string | undefined) ?? null,
        eventDateStart: (p.eventDateStart as string | undefined) ?? null,
        eventLocation: (p.eventLocation as string | undefined) ?? null,
        amountPaid: Number(p.amountPaid ?? 0),
        items: ((p.items as Array<{ quantity: number; unit_price: number; ticketTypeLabel?: string | null }> | undefined) ?? [])
          .map(item => ({ quantity: item.quantity, label: item.ticketTypeLabel ?? null, unitPrice: item.unit_price })),
        ticketUrl: (p.ticketUrl as string | undefined) ?? null,
        eventsUrl: getEventsBaseUrl(),
        testMode: true,
      });
    case 'review-invite':
      return reviewInviteEmail(context, {
        kind: p.kind === 'reminder' ? 'reminder' : 'initial',
        orderNumber: String(p.orderNumber ?? ''),
        reviewUrl: String(p.reviewUrl ?? ''),
        expiresAt: String(p.expiresAt ?? ''),
        testMode: true,
      });
    case 'card-quick-payment-customer':
    case 'card-quick-payment-customer-app-live':
      return cardQuickPaymentCustomerEmail(context, {
        quickPaymentId: String(p.orderId ?? ''), amount: Number(p.total ?? 0), currency: context.currency || 'EUR',
        customerName: order.fullName, paidAt: String(p.testSentAt ?? new Date().toISOString()), testMode: true,
      });
    case 'tester-feedback-invite': {
      const email = (p.email ?? {}) as { subject?: string; html?: string };
      return email.subject && email.html ? { subject: `[TEST] ${email.subject}`, html: email.html } : null;
    }
    default:
      return null;
  }
}

function isTestEvent(value: unknown): value is TestEvent {
  return typeof value === 'string' && value in WEBHOOK_PATHS;
}

function isEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isGooglePlayTestUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'play.google.com';
  } catch {
    return false;
  }
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
  const reviewInviteKind: ReviewInviteKind = body.reviewInviteKind === 'reminder' ? 'reminder' : 'initial';
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

  if (body.event === 'tester-feedback-invite') {
    const googlePlayTestUrl = body.googlePlayTestUrl?.trim()
      || 'https://play.google.com/store/apps/details?id=com.lepefy.notification-test';
    if (!isGooglePlayTestUrl(googlePlayTestUrl)) {
      return NextResponse.json({ error: 'URL Google Play de test invalide.' }, { status: 400 });
    }

    const feedbackInviteUrl = 'https://example.invalid/lepefy-feedback-invite-test';
    const invitationEmail = buildTesterFeedbackInviteEmail(
      tenantContext.tenantName,
      tenantContext.branding.logoUrl,
      googlePlayTestUrl,
      feedbackInviteUrl,
    );
    payload = {
      type: 'tester_feedback_invite',
      tenant: {
        id: tenantContext.tenantId,
        name: tenantContext.tenantName,
        logo_url: tenantContext.branding.logoUrl,
      },
      campaign: {
        id: testId,
        name: 'Campagne synthétique · Console notifications',
        version_label: 'TEST',
      },
      recipient: { email: body.email.trim() },
      links: {
        google_play_test_url: googlePlayTestUrl,
        feedback_invite_url: feedbackInviteUrl,
      },
      email: {
        subject: invitationEmail.subject,
        html: invitationEmail.html,
        text: invitationEmail.text,
        platform_signature: LEPEFY_PLATFORM_SIGNATURE,
        platform_tagline: LEPEFY_PLATFORM_TAGLINE,
      },
      testMode: true,
    };
  } else if (body.event === 'review-invite') {
    if (!tenantContext.storefrontUrl) {
      return NextResponse.json({ error: 'URL storefront du tenant indisponible.' }, { status: 500 });
    }
    const storefrontUrl = tenantContext.storefrontUrl.replace(/\/$/, '');
    payload = {
      ...tenantContext,
      testMode: true,
      testSource: 'platform_notification_console',
      testSentAt,
      kind: reviewInviteKind,
      orderId: testId,
      orderNumber: `#TEST-${shortId}`,
      email: body.email.trim(),
      fullName: body.fullName?.trim() || 'Client test',
      reviewUrl: `${storefrontUrl}/avis/donner?token=notification-test`,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      verifiedPurchase: true,
    };
  } else if (body.event === 'order-confirmed') {
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
  } else if (body.event === 'card-quick-payment-customer' || body.event === 'card-quick-payment-customer-app-live') {
    payload = { ...commonPayload, total };
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
    const alert = buildOrderStockConflictNotification(tenantContext, [body.email.trim()], {
      orderId: testId,
      orderNumber: `#TEST-${shortId}`,
      email: body.email.trim(),
      fullName: body.fullName?.trim() || 'Client test',
      fulfillmentType,
      total,
      reason: 'Test console — conflit de stock simulé',
      refundSucceeded: true,
      manualRefundRequired: false,
      adminOrderLink: tenantContext.storefrontUrl ? `${tenantContext.storefrontUrl}/admin/orders/${testId}` : '',
    });
    payload = { ...commonPayload, ...alert, subject: `[TEST] ${alert.subject}` };
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

  // Phase 2: these events are rendered in-app and delivered through send-email,
  // exactly like production; the console tests the real email.
  let webhookPath = WEBHOOK_PATHS[body.event];
  // Preview of the launch-day state: the Android app treated as public (badge + Play Store link).
  const renderContext: TenantNotificationContext = body.event === 'card-quick-payment-customer-app-live'
    ? { ...tenantContext, mobileApp: { android: androidAppState(tenant.android_package_name || 'com.example.app', true) } }
    : tenantContext;
  const rendered = renderInAppTestEmail(body.event, renderContext, payload);
  if (rendered) {
    webhookPath = SEND_EMAIL_WEBHOOK;
    const sender = body.event === 'tester-feedback-invite' ? { ...PLATFORM_EMAIL_CONTEXT, tenantId: tenantContext.tenantId } : tenantContext;
    payload = emailRequest(sender, {
      ...rendered,
      notificationType: `console_test_${body.event.replace(/-/g, '_')}`,
      idempotencyKey: `console-test:${testId}`,
      recipients: [body.email.trim()],
    }, false)[1];
  }

  // Rendered emails follow the production transport switch (n8n or Brevo API).
  if (RENDERED_EMAIL_WEBHOOKS.has(webhookPath)) {
    const result = await sendNotification(webhookPath, payload);
    return NextResponse.json({
      ok: result.ok,
      event: body.event,
      webhookPath,
      transport: result.transport,
      status: result.httpStatus ?? (result.ok ? 200 : 502),
      response: JSON.stringify(result.ok ? { accepted: true, messageId: result.messageId ?? null } : { accepted: false, error: result.error }),
      payload,
    }, { status: result.ok ? 200 : 502 });
  }

  try {
    const response = await fetch(n8nWebhookUrl(webhookPath)!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(n8nWebhookHeaders(webhookPath) ?? {}) },
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
