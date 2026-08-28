# Event external payment tenant alert

## Trigger

When `POST /api/events/[id]/checkout-external-link` successfully creates an `event_reservation_requests` row, the application sends a best-effort internal tenant alert.

The request remains `pending`; no event capacity is reserved and no `event_reservations` row is created until an authorized admin confirms the external payment.

## Recipients

Recipients are resolved server-side from active `tenant_notification_recipients` rows with:

```text
notify_external_payment_pending = true
```

Email addresses must not be hardcoded in application code or n8n.

## n8n webhook

```text
/webhook/event-external-payment-awaiting-verification
```

Expected payload:

```ts
{
  notificationType: 'event_external_payment_awaiting_verification',
  recipients: string[],
  requestId: string,
  paymentReference: string,
  event: {
    id: string,
    title: string,
    dateStart: string,
    location: string | null
  },
  customer: {
    fullName: string,
    email: string,
    phone: string | null
  },
  paymentMethod: {
    type: string,
    label: string
  },
  amount: number,
  currency: string,
  quantityTotal: number,
  items: Array<{
    ticketTypeId: string,
    name: string,
    price: number,
    quantity: number
  }>,
  adminPaymentLink: string | null,
  eventsUrl: string,
  createdAt: string,
  notificationSentAt: string,

  // plus the standard tenant notification context
  tenantId: string,
  tenantSlug: string,
  tenantName: string,
  storefrontUrl: string,
  locale: string,
  branding: object,
  emailBranding: object,
  business: object,
  pickup: object
}
```

`storefrontUrl` is intentionally preserved for backward compatibility with the shared tenant notification context and existing Shop workflows. `eventsUrl` is the canonical public Events base URL resolved by `getEventsBaseUrl()` (`NEXT_PUBLIC_EVENTS_SUBDOMAIN` first, then the existing storefront/app fallback).

`adminPaymentLink` intentionally remains based on `storefrontUrl`; adding `eventsUrl` does not change the existing admin/payment confirmation route or authentication flow.

## Tenant email contract

Subject recommendation:

```text
Paiement à vérifier · <event title> · <amount>
```

The message must make these facts explicit:

1. a customer used an external payment method for an event request;
2. the payment is not considered confirmed by Lepefy;
3. the tenant must check the external provider before confirming;
4. no event capacity is reserved yet;
5. the primary CTA is `Vérifier et confirmer` using `adminPaymentLink`.

The email should show event, customer, requested formulas, total people, expected amount and external payment method.

For event-facing footer or secondary navigation links, n8n should use `eventsUrl` rather than `storefrontUrl`.

## Failure semantics

Notification delivery is best-effort. Missing recipients, unavailable tenant notification context or an n8n transport failure must be logged but must never roll back or fail the already-created `event_reservation_requests` row.

The admin pending-payment queue remains the source of truth even if the email is not delivered.
