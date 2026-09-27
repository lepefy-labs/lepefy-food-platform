# Notification Journey v1

## Scope

Notification Journey v1 defines the transactional customer communication model for shop orders, the manual recovery model for unresolved external payments, and the internal tenant alerting required to resolve external payments safely.

The goal is to communicate only meaningful milestones, reduce uncertainty, and make every message answer four questions in this order:

1. What happened?
2. What does it mean for the recipient?
3. What should the recipient do now?
4. What happens next?

v1 is transactional. It does not include abandoned-checkout marketing, review requests, cross-sell, loyalty campaigns, or recurring pickup reminders.

## Shared delivery model

n8n is the transport/orchestration layer. Application code is the source of truth for order state, checkout state, recipient selection, idempotency and webhook payloads.

All customer-facing order events receive the tenant notification context:

- tenant identity: `tenantId`, `tenantSlug`, `tenantName`
- canonical storefront: `storefrontUrl`
- `locale`, `currency`
- `branding.logoUrl`, `primaryColor`, `secondaryColor`, `accentColor`
- `emailBranding.fromName`, `fromEmail`, `supportEmail`, `whatsappNumber`
- `business.city`, `country`, `legalAddress`
- `pickup.address`, `pickup.mapsUrl`, `pickup.hours`

`pickup.*` must come from tenant Click & Collect configuration, not from the legal address.

Email is the outbound channel in v1. WhatsApp is exposed as a support/contact action, not as an automatic outbound status channel.

Internal tenant notifications use `tenant_notification_recipients`; recipient addresses must never be hardcoded in application code or n8n workflows.

Transport: every outbound call goes through `notifyN8n` / `n8nWebhookUrl` / `n8nWebhookHeaders` (`lib/events/notifyN8n.ts`), never a hand-built `fetch`. Each request carries `X-Lepefy-Webhook-Secret`: the daily digest uses its dedicated `N8N_DAILY_DIGEST_WEBHOOK_SECRET` (fails closed), every other notification uses `N8N_NOTIFICATION_WEBHOOK_SECRET`. While the shared secret is not configured the header is omitted and a warning is logged (rollout only). Each n8n webhook must attach the matching Header Auth credential, and should answer only after the SMTP result (`responseMode: lastNode` or a Respond node), otherwise the application's `accepted`/`sent` booleans do not reflect delivery.

## Generic email channel (`/webhook/send-email`)

New notifications are rendered by the application and delivered through one n8n workflow, "Lepefy · Send email" (`ops/n8n/send-email.json`), instead of one n8n workflow per template. The application uses `sendTenantEmail` / `deliverEmail` (`lib/notifications/sendEmail.ts`) with templates in `lib/notifications/operationalEmails.ts` (escaped HTML, tenant branding). Payload: `notificationType`, `tenantId`, `idempotencyKey` (`<prefix>:<stable id>`), `recipients[]` (max 20), `subject`, `html`, optional `replyTo`, `emailBranding`. The workflow checks the shared webhook secret, validates the payload, only accepts senders `@lepefy.com`, claims the key in `lepefy_n8n.digest_email_claims`, sends via SMTP and answers 200 (accepted or duplicate), 400 (invalid), 502 (SMTP rejected) or 503 (claim busy).

| `notificationType` | Trigger | Recipients | Key |
| --- | --- | --- | --- |
| `event_capacity_conflict` | Paid event reservation refused, capacity reached | `notify_order_stock_conflict` | `event-capacity-conflict:<intent>` |
| `rental_stock_conflict` | Paid rental refused, stock unavailable | `notify_order_stock_conflict` | `rental-stock-conflict:<intent>` |
| `service_inquiry_created` | New quote request (`/api/services/[slug]/inquiry`) | `notify_service_inquiries` (reply goes to the customer) | `service-inquiry:<inquiryId>` |
| `rental_reservation_confirmed_customer` | Rental reservation created | the customer | `rental-reservation:<id>:customer` |
| `rental_reservation_confirmed_admin` | Rental reservation created | `notify_rental_reservations` | `rental-reservation:<id>:admin` |
| `rental_delivery_quote_pending` | Rental delivery without zone price | `notify_rental_reservations` | `rental-delivery-quote:<id>` |
| `marketing_campaign` | Admin dispatches an email campaign | each consenting customer | `marketing-campaign:<recipient key>` |

`notify_service_inquiries` and `notify_rental_reservations` come from migration `135` (additive, default `false`; applied in production on 27 Sept 2026). Without the migration, or when no recipient opted in, the internal alert is skipped and logged; adding a recipient keeps working because the new flags are written only when enabled.

Marketing emails have **no automatic unsubscribe link yet** (decision of 27 Sept 2026, to be implemented later). Until then each campaign email ends with a manual opt-out sentence, and replies go to the tenant support address (`replyTo`). Opt-out requests must be processed by hand by revoking `customers.marketing_consent`.

## Templates moved into Lepefy (phase 2)

Batch A (27 Sept 2026): `order-confirmed`, `order-shipped`, `order-ready-for-pickup`, `order-completed`, `order-cancelled` and `payment-reminder` are rendered by `lib/notifications/customerEmails.ts` (same copy and structure as the former n8n templates, escaped values, `[TEST]` banner/subject in test mode) and delivered through `send-email` with the ledger, so every one of them is deduplicated on its key. `notificationType`: `order_confirmed`, `order_shipped`, `order_ready_for_pickup`, `order_completed`, `order_cancelled`, `payment_reminder`. The platform test console renders these events with the same builders and sends them through `send-email` (`console_test_*`, key `console-test:<uuid>`).

The six former n8n workflows ("Notifica conferma ordine cliente", "spedizione cliente", "ordine pronto per il ritiro", "ordine completato", "ordine annullato", "attesa pagamento") were validated with console test emails and deactivated on 27 Sept 2026.

Batch B (27 Sept 2026): `event_reservation_confirmed` (create and resend, `lib/events/sendEventReservationConfirmation.ts`, with ledger), `external_payment_awaiting_verification` and `event_external_payment_awaiting_verification` (their session/request claim stays the dedup mechanism: no ledger), `card_quick_payment` (ledger, key `card-quick-payment:<intent>`), `review_invite` (`review_invites` keeps its processing state: no ledger), `tester_feedback_invite` and `admin_invited` (platform emails sent as "Lepefy Food Platform" via `PLATFORM_EMAIL_CONTEXT`, no ledger). Templates live in `customerEmails.ts` with the same structure; the console renders them too. Their seven former n8n workflows were validated with console test emails (card quick payment and admin invitation are not in the console and are validated by their first real send) and deactivated on 27 Sept 2026.

Active Lepefy n8n workflows after phase 2: "Send email", "Order stock conflict alert", "Daily order digest email receiver" and "dispatcher", "Notification retry scheduler", "Shipping campaign scheduler". "Event booking closed reports" is no longer called since attachments moved to `send-email`; it stays active only as a rollback path until the first real closing report is sent through `send-email`.

Attachments (27 Sept 2026): `send-email` accepts an optional `attachments[]` (`filename`, `contentType`, `contentBase64`; at most 5 files, PDF/CSV/XLSX/PNG/JPEG with a matching content type, names up to 120 safe characters, about 10 MB of base64 in total). The "Attach files" node turns them into binary properties sent as regular file attachments (`fileAttachments`). Deliveries with attachments should not use the ledger, which would store them in its payload. The event booking closed reports (`event_booking_closed_reports`, key `event-booking-close-reports:<event>:<dispatch token>`, CSV + two PDFs) are rendered in-app (`eventBookingClosedReportsEmail`) and sent this way; the event dispatch token remains their dedup mechanism.

## Direct email transport (phase 3, Brevo API)

`EMAIL_TRANSPORT` selects how rendered emails leave the application (`lib/notifications/emailTransport.ts`, `sendNotification` in `lib/events/notifyN8n.ts`):

- `n8n` (default): payloads go to the n8n webhooks `send-email`, `order-stock-conflict` and `daily-order-digest` as before;
- `brevo`: the same payloads are sent to the Brevo transactional API (`POST https://api.brevo.com/v3/smtp/email`, key `BREVO_API_KEY`, server-side only), with the checks the n8n workflow applied (sender `@lepefy.com` only, 1–20 recipients, no newline in the subject, attachment rules, 15 s timeout). The key goes in a custom header `X-Lepefy-Idempotency-Key` and the notification type in Brevo `tags`. Brevo has no idempotency keys: deduplication stays in Lepefy (ledger, claims), so a retry after a timeout can still duplicate in rare cases.

Every other n8n webhook is unaffected, and switching back to `n8n` only needs the environment variable (plus a redeploy). The current SMTP account behind n8n is Brevo (`smtp-relay.brevo.com`), so the sender domain is already authenticated.

Where to look when an email fails:

1. Admin → Plateforme → Notifications → Historique (`/admin/platform/notifications/historique`) (platform owner only; tenants never see transports, provider ids or raw errors): every tenant email (retry ledger rows and "log" rows for flows that own their dedup: external payment alerts, review/tester invites, closing reports, marketing, daily digest), with status, attempts, the exact transport error (for example `brevo_http_400 …`) and, since migration `137`, the transport and Brevo message id with a link to the Brevo logs;
2. Brevo → Transactional → Logs: what happened after acceptance (delivered, bounced, blocked, spam), searchable by message id or recipient;
3. Vercel → project logs: `[email] brevo accepted|rejected …` lines and runtime errors (short retention);
4. n8n keeps the schedulers (daily digest dispatcher, notification retry scheduler, shipping campaign scheduler) and, while `EMAIL_TRANSPORT=n8n`, the email executions.

Platform emails without a tenant (admin invitation) are not recorded in the history; they appear in the Vercel logs only.

## Delivery ledger and retries (migration `136`)

`notification_deliveries` records every notification sent with `notifyN8n(path, payload, { tenantId, idempotencyKey, notificationType })` (`lib/notifications/deliveryLedger.ts`):

- one row per `(tenant_id, idempotency_key)`: the same logical message is never queued or sent twice (e.g. `order-shipped:<orderId>`, `order-confirmed:<orderId>`); intentional resends use a fresh key (`payment-reminder:<session>:<n>`, `event-reservation-resend:<id>:<uuid>`);
- the first attempt is immediate; on failure the row becomes `failed` with backoff 1, 5, 15, 60, 240 minutes, then `dead` after 5 attempts;
- `POST /api/internal/notifications/dispatch` (Bearer `DAILY_DIGEST_CRON_SECRET`, the internal scheduler secret shared with the digest dispatcher) claims due rows with `claim_notification_deliveries` (`FOR UPDATE SKIP LOCKED`, 2-minute lock recovering crashed sends) and is called every 5 minutes by the n8n workflow "Lepefy · Notification retry scheduler" (`ops/n8n/notification-retry-scheduler.json`);
- the payload (which contains personal data) is cleared as soon as n8n accepts it; subject and recipients stay for the admin history; accepted and dead rows are purged after 90 days;
- Admin → Plateforme → Notifications → Historique (`/admin/platform/notifications/historique`) (platform owner only, `GET /api/admin/platform/notification-deliveries`, `POST …/[id]/retry`, guarded by `requirePlatformOwner`) lists the last 50 deliveries and offers "Réessayer" on failed/dead rows (compare-and-set claim, three more automatic attempts);
- without migration 136 every call falls back to a single direct send, as before.

Covered: order lifecycle (confirmed, shipped, ready for pickup, completed, cancelled, stock conflict), payment reminder, card quick payment, event reservation confirmation/resend, and every `send-email` notification except marketing. Not covered on purpose because they keep their own ledger or claim: daily digest (`tenant_daily_digest_runs`), external payment alerts (session claim), review invites, event close reports, tester invites and marketing (`marketing_campaign_recipients`). A retry after a timeout can still duplicate an email for workflows without n8n-side idempotency (the legacy per-template workflows); `send-email`, `order-stock-conflict` and the digest deduplicate on the key.

## Customer journey

| Event | Trigger | Customer meaning | Primary CTA | v1 channel |
| --- | --- | --- | --- | --- |
| `order-confirmed` | Payment confirmed and order created | Payment received, order registered, preparation started | `Voir ma commande` | Email |
| `order-ready-for-pickup` | Pickup order reaches `ready_for_pickup` | The order can be collected now and the customer knows where/how | `Itinéraire vers la boutique` when `pickup.mapsUrl` exists | Email |
| `order-shipped` | Delivery order reaches `shipped` | Parcel has left and tracking information is available | `Voir le suivi` / order tracking page | Email |
| `order-completed` + `completionType=delivered` | Delivery order reaches `delivered` | Delivery is recorded as completed; support remains available | `Voir ma commande` | Email |
| `order-completed` + `completionType=picked_up` | Pickup order reaches `delivered` | Collection is complete and order is closed | `Voir ma commande` | Email |
| `order-cancelled` | Order reaches `cancelled` | Order is cancelled and customer knows what happens next | `Voir ma commande` or support | Email |
| `order-stock-conflict` | Post-payment stock decrement conflict | Operational incident requiring staff handling | Admin/internal in v1 | Internal |

### Assisted orders and orders without email

Assisted orders (`docs/ASSISTED_ORDERS.md`) reuse the same events, emitted once by the winning conversion
(`convert_checkout_session_to_order`). `order-confirmed` is never sent before payment confirmation; for payments
recorded by staff it is sent only if the operator ticks the option. When the customer has no email (phone-only
WhatsApp customer), `order-confirmed` and every status email above are skipped and never reported as sent;
the tracking link is shared manually from the admin (copy / WhatsApp). No WhatsApp message is sent automatically.

## Events intentionally not sent

### `preparing`

Do not send a separate generic "order in preparation" email in v1.

Orders are created in `preparing`, and `order-confirmed` already tells the customer that preparation has started. Sending both in normal flows creates noise without adding useful information.

A future preparation-delay notification may be added only for long-running or exceptional workflows.

## Message design system

Every transactional email should use the same recognizable structure:

1. Optional test banner when `testMode === true`.
2. Tenant-branded header with logo, primary color, state icon, and state title.
3. Short explanation of the current milestone.
4. State-specific information card with the approved tenant accent.
5. Exactly one primary CTA.
6. Secondary order/support actions only when useful.
7. Tenant support box with email and/or WhatsApp when customer-facing.
8. Tenant footer with business identity and canonical storefront.

Test messages must use `[TEST]` in the subject and display a visible in-email test banner.

Do not include n8n branding in customer-facing or tenant-facing production emails.

## Event specifications

### 1. Order confirmed

Webhook: `/webhook/order-confirmed`

Customer intent:
- reassure that payment was received;
- confirm the order number and fulfillment mode;
- show totals/address when provided;
- explain the next milestone.

Primary CTA:
- `Voir ma commande` using `orderTrackingLink`.

Delivery copy should say the customer will be notified when the order ships.
Pickup copy should say the customer will be notified when the order is ready.

Do not promise a delivery date that is not in the payload.

### 2. Ready for pickup

Webhook: `/webhook/order-ready-for-pickup`

Customer intent:
- make it obvious that collection is possible now;
- provide the actual Click & Collect address;
- provide opening/pickup hours when configured;
- make navigation one tap away.

Primary CTA:
- `Itinéraire vers la boutique` -> `pickup.mapsUrl`, when available.

Secondary CTA:
- `Voir ma commande` -> `orderTrackingLink`.

Data:
- `pickup.address`
- `pickup.mapsUrl`
- `pickup.hours`

Never substitute `business.legalAddress` for pickup location when `pickup.address` is configured.

### 3. Order shipped

Webhook: `/webhook/order-shipped`

Customer intent:
- make it clear that the parcel has left;
- expose carrier and tracking code;
- give one obvious route to follow progress.

Payload-specific data:
- `trackingCode`
- `trackingCarrier`
- `orderTrackingLink`

Primary CTA in v1:
- order tracking page via `orderTrackingLink`.

Do not fabricate a carrier tracking URL when the application does not provide one.

### 4. Order delivered

Webhook: `/webhook/order-completed`
`completionType: "delivered"`

Customer intent:
- confirm completion;
- make support easy if delivery was not received or has a problem.

Primary CTA:
- `Voir ma commande`.

Support should be more prominent than promotional content.
Do not include review/marketing requests in v1.

### 5. Order picked up

Webhook: `/webhook/order-completed`
`completionType: "picked_up"`

Customer intent:
- close the pickup journey;
- thank the customer;
- leave access to order details/support.

Primary CTA:
- `Voir ma commande`.

Keep the email short. Do not send another generic "delivered" message for pickup.

### 6. Order cancelled

Webhook: `/webhook/order-cancelled`

Customer intent:
- state cancellation clearly;
- make the next step understandable;
- provide support.

Never promise a refund merely because an order is cancelled.
Refund wording must depend on real payment/refund state supplied by the application.

Until such refund-state data is explicitly part of the customer payload, use neutral wording and direct the customer to support/order details.

### 7. Stock conflict

Webhook: `/webhook/order-stock-conflict`

This is not a normal customer lifecycle email in v1.

The current payload contains operational fields such as:
- `reason`
- `refundSucceeded`
- `manualRefundRequired`
- `adminOrderLink`

Therefore v1 treats this webhook as an internal/admin incident notification.

Since 27 Sept 2026 the application renders this alert itself (`lib/notifications/orderStockConflictEmail.ts`), resolves `recipients[]` from `tenant_notification_recipients.notify_order_stock_conflict` and adds `subject`, escaped `html` and `idempotencyKey` (`order-stock-conflict:<orderId>`). The n8n workflow "Lepefy · Order stock conflict alert" only validates, claims the key in `lepefy_n8n.digest_email_claims` and delivers via SMTP, like the daily digest receiver. Both the central conversion service and the storefront Stripe card path use it. No alert is sent (error logged) when the tenant has no opted-in recipient.

A future customer incident flow must be designed separately around the actual refund/resolution state before sending automated customer copy.

## Payment Recovery v1

Payment Recovery is a separate lifecycle from order notifications because an unresolved external-payment checkout is not yet an order.

Domain model:

```text
checkout_session -> external provider handoff -> awaiting verification -> admin resolution
```

Admin entry point:

```text
/admin/paiements-en-attente/[id]
```

The pending-payment banner keeps `Confirmer réception` as the primary operational action and exposes `Gérer` for recovery/reminder/cancellation details. Destructive cancellation is not a primary row action.

### Tenant verification alert

Webhook: `/webhook/external-payment-awaiting-verification`

When a shop external-link checkout really reaches `awaiting_verification`, the application sends a best-effort **internal tenant notification** so staff know that an external payment must be checked manually.

Recipients:

- resolved server-side from active `tenant_notification_recipients` rows;
- only recipients with `notify_external_payment_pending = true` are included;
- n8n receives the already-resolved `recipients[]` list and must not maintain a separate hardcoded mailing list.

Idempotency:

- one accepted tenant alert per checkout session;
- `checkout_sessions.external_payment_tenant_notified_at` is used as an atomic send claim;
- if no recipient is configured, tenant context cannot be resolved, or n8n does not accept the webhook, the claim is released so a later retry can attempt delivery;
- notification failures must never fail or roll back the customer checkout/provider handoff.

Tenant-facing copy must describe an **achat/paiement externe à vérifier**, not a confirmed order. It must explicitly say that the payment needs manual verification before confirmation and that no stock is reserved yet.

Primary CTA:

- `Vérifier le paiement` -> `adminPaymentLink` -> `/admin/paiements-en-attente/[id]`.

Payload includes:

- full tenant notification context;
- `recipients[]`;
- `checkoutSessionId`, `paymentReference`;
- `customer.fullName`, `customer.email`, `customer.phone`;
- `paymentMethod.type`, `paymentMethod.label`;
- `amount`, `fulfillmentType`, `items`, `shippingAddress`;
- `adminPaymentLink`;
- `createdAt`, `notificationSentAt`.

### Manual reminder

Webhook: `/webhook/payment-reminder`

v1 is **manual admin-triggered transactional recovery**, not abandoned-cart automation or marketing.

Server rules:

- first reminder no earlier than 2 hours after checkout creation;
- maximum 1 reminder per 24 hours;
- maximum 2 reminders per checkout session;
- only unresolved external-link sessions without an order are eligible;
- reminder history is persisted server-side for audit/cooldown;
- a failed n8n transport must not be presented as a successful reminder.

Customer copy must never state that payment was definitely not received. Use wording equivalent to:

`Nous n’avons pas encore pu confirmer la réception de votre paiement.`

When the provider handoff may already have happened, the message must explicitly warn:

`Si vous avez déjà effectué le paiement, ne payez pas une seconde fois.`

Primary CTA:

- `Reprendre mon achat` -> signed `resumeLink`.

The resume destination is the tenant storefront checkout recovery route, not the payment-provider URL. The customer may:

- keep the same external payment method;
- select another enabled external method;
- switch to card/Stripe.

The signed checkout-session access token already used by checkout recovery is the only guest access mechanism. Do not introduce a second token format or expose unrestricted checkout identifiers.

`awaiting_verification` is durable and is not expired solely because the original 24-hour open-checkout TTL passed. When a customer deliberately switches such a session to Stripe, it returns to `open` so the normal Stripe PaymentIntent flow can continue.

Payment-reminder payload includes:

- full tenant notification context;
- `checkoutSessionId`;
- `paymentReference`;
- `email`, `fullName`;
- `paymentMethod.type`, `paymentMethod.label`;
- `amount`;
- `resumeLink`;
- `paymentStatus`;
- `providerHandoffStarted`;
- `reminderNumber`;
- `idempotencyKey`;
- `reminderSentAt`.

### What Payment Recovery v1 does not do

- no automatic customer reminder schedule;
- no marketing/abandoned-cart campaign;
- no claim that an external payment failed;
- no second-payment encouragement when provider handoff has already occurred;
- no stock reservation;
- no order creation before confirmed payment.

The automatic **tenant verification alert** is operational and internal; it is intentionally distinct from automated customer recovery.

## CTA hierarchy

One email = one primary action.

Priority by event:

- confirmed -> order details
- ready for pickup -> maps/directions
- shipped -> tracking/order tracking page
- delivered -> order details/support
- picked up -> order details
- cancelled -> order details/support
- external payment tenant alert -> pending-payment admin page
- payment reminder -> secure checkout resume

Do not let support, storefront browsing, or secondary links visually compete with the event-specific primary CTA.

## Tone

Use concise, reassuring French customer copy and concise operational French for tenant alerts.

Good:
- `Bonne nouvelle, votre commande est prête à être retirée.`
- `Votre commande est en route.`
- `Votre paiement a bien été reçu.`
- `Nous n’avons pas encore pu confirmer la réception de votre paiement.`
- `Un paiement externe est à vérifier.`

Avoid exaggerated marketing language, technical system terms, or excessive emoji.

Use emoji/icons as state markers only: `✅`, `📦`, `🚚`, `🏪`, `📍`, `💳`.

## Future v2 candidates

Not part of v1:

- delayed preparation notification;
- pickup reminder after a configured delay;
- carrier-native tracking URL normalization;
- delivery exception notification;
- review request;
- loyalty/reorder message;
- consent-aware automated abandoned checkout lifecycle messaging;
- automatic customer payment-recovery reminders;
- outbound WhatsApp/SMS status notifications.

Each future automatic outbound channel or marketing lifecycle requires explicit tenant configuration, consent and timing rules before activation.
