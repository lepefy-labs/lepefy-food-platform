# Notification Journey v1

## Scope

Notification Journey v1 defines the transactional customer communication model for shop orders.

The goal is to communicate only meaningful order milestones, reduce uncertainty, and make every
message answer four questions in this order:

1. What happened?
2. What does it mean for the customer?
3. What should the customer do now?
4. What happens next?

v1 is transactional. It does not include abandoned-checkout marketing, review requests, cross-sell,
loyalty campaigns, or recurring pickup reminders.

## Shared delivery model

n8n is the transport/orchestration layer. Application code is the source of truth for order state and
webhook payloads.

All customer-facing order events receive the tenant notification context:

- tenant identity: `tenantId`, `tenantSlug`, `tenantName`
- canonical storefront: `storefrontUrl`
- `locale`, `currency`
- `branding.logoUrl`, `primaryColor`, `secondaryColor`, `accentColor`
- `emailBranding.fromName`, `fromEmail`, `supportEmail`, `whatsappNumber`
- `business.city`, `country`, `legalAddress`
- `pickup.address`, `pickup.mapsUrl`, `pickup.hours`

`pickup.*` must come from tenant Click & Collect configuration, not from the legal address.

Email is the outbound channel in v1. WhatsApp is exposed as a support/contact action, not as an
automatic outbound status channel.

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

## Events intentionally not sent

### `preparing`

Do not send a separate generic "order in preparation" email in v1.

Orders are created in `preparing`, and `order-confirmed` already tells the customer that preparation
has started. Sending both in normal flows creates noise without adding useful information.

A future preparation-delay notification may be added only for long-running or exceptional workflows.

## Message design system

Every transactional email should use the same recognizable structure:

1. Optional test banner when `testMode === true`.
2. Tenant-branded header with logo, primary color, state icon, and state title.
3. Short explanation of the current milestone.
4. State-specific information card with `branding.secondaryColor` as the accent.
5. Exactly one primary CTA.
6. Secondary order/support actions only when useful.
7. Tenant support box with email and/or WhatsApp.
8. Tenant footer with business identity and canonical storefront.

Test messages must use `[TEST]` in the subject and display a visible in-email test banner.

Do not include n8n branding in customer-facing production emails.

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

Until such refund-state data is explicitly part of the customer payload, use neutral wording and
direct the customer to support/order details.

### 7. Stock conflict

Webhook: `/webhook/order-stock-conflict`

This is not a normal customer lifecycle email in v1.

The current payload contains operational fields such as:
- `reason`
- `refundSucceeded`
- `manualRefundRequired`
- `adminOrderLink`

Therefore v1 treats this webhook as an internal/admin incident notification.

A future customer incident flow must be designed separately around the actual refund/resolution state
before sending automated customer copy.

## CTA hierarchy

One email = one primary action.

Priority by event:

- confirmed -> order details
- ready for pickup -> maps/directions
- shipped -> tracking/order tracking page
- delivered -> order details/support
- picked up -> order details
- cancelled -> order details/support

Do not let support, storefront browsing, or secondary links visually compete with the event-specific
primary CTA.

## Tone

Use concise, reassuring French customer copy.

Good:
- `Bonne nouvelle, votre commande est prête à être retirée.`
- `Votre commande est en route.`
- `Votre paiement a bien été reçu.`

Avoid exaggerated marketing language, technical system terms, or excessive emoji.

Use emoji/icons as state markers only: `✅`, `📦`, `🚚`, `🏪`, `📍`.

## Future v2 candidates

Not part of v1:

- delayed preparation notification;
- pickup reminder after a configured delay;
- carrier-native tracking URL normalization;
- delivery exception notification;
- review request;
- loyalty/reorder message;
- consent-aware abandoned checkout lifecycle messaging;
- outbound WhatsApp/SMS status notifications.

Each future outbound channel or marketing lifecycle requires explicit tenant configuration, consent
and timing rules before activation.
