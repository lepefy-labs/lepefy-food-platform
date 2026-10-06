# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lepefy Food is a **multi-tenant SaaS e-commerce platform** for African food shops in Europe. Each tenant (e.g., ChloeFood) gets an independently branded storefront with product catalog, cart, checkout, Packlink shipping integration, and Stripe payments.

## Commands

All commands run from the repo root using **pnpm workspaces**.

```bash
pnpm dev          # Start Next.js dev server
pnpm build        # Production build
pnpm lint         # ESLint
pnpm typecheck    # TypeScript type-check (tsc --noEmit)
```

Type-checking is the primary correctness check:
```bash
cd apps/storefront && pnpm typecheck
```

Unit tests (Playwright test runner used for pure/isolated logic, not browser E2E) live in `apps/storefront/tests/unit/`:
```bash
cd apps/storefront && pnpm test:unit
```
A separate browser E2E suite exists in `apps/storefront/tests/e2e/` (`pnpm test:e2e`); it targets `https://chloefood.com` by default and needs `E2E_TEST_SECRET` to flag orders as `is_test` — do not run it without that secret configured, or it exercises live Stripe/order creation.

Database migrations (requires Supabase CLI):
```bash
supabase db push                    # Apply migrations to remote
supabase start                      # Start local Supabase instance
```

## Architecture

### Monorepo Structure

- `apps/storefront/` — Next.js 14 App Router application (the entire product)
- `packages/types/` — Shared TypeScript types (`@lepefy/types`), imported by the storefront
- `supabase/migrations/` — Ordered SQL migration files; apply sequentially
- `scripts/` — One-off Node.js scripts (e.g., Gemini-based product image generation)

### Multi-Tenancy

Tenant is resolved at startup via `NEXT_PUBLIC_TENANT_SLUG` env var. The flow:

1. `apps/storefront/src/lib/tenant/getTenant.ts` fetches the tenant row from Supabase (Next.js `cache()`)
2. Root layout (`src/app/layout.tsx`) calls `getTenant()`, applies CSS custom properties from tenant config, and wraps the tree in `TenantProvider` with `toPublicTenant(tenant)`. The full row (provider keys, billing, private AI context) is server-only: anything passed to a Client Component must go through `toPublicTenant()` (`src/lib/tenant/publicTenant.ts`, allow-list `PUBLIC_TENANT_FIELDS` in `packages/types/tenant.ts`) or an explicit hand-built projection — never `tenant={tenant}` from `getTenant()`
3. All Supabase queries filter by `tenant_id` — enforced both in application code and via Supabase RLS policies (`supabase/migrations/002_rls_policies.sql`)

### Data Flow: Checkout

```
Cart (Zustand, localStorage)
  → /checkout page
    → POST /api/shipping/quote  (Packlink API → cheapest rate + VAT + surcharge)
    → POST /api/checkout        (creates order + Stripe PaymentIntent or in-store order)
  → /order-confirmation
```

### Purchase Quantity Rules (minimum + step, per product and per combinable group)

`products.min_order_quantity` / `products.order_quantity_step` (migration `121_purchase_quantity_rules.sql`, default `1`/`1` — no behavior change until a tenant configures otherwise) express a generic rule: quantity `q` is valid iff `q >= minimum AND (q - minimum) % step == 0`. The same migration adds `purchase_quantity_groups` / `purchase_quantity_group_products` for an aggregate minimum across a combinable group of products (e.g. a "Boissons" group with minimum 12, any mix of member products counting toward the total) — group membership is explicit, never derived from `categories`.

- **Single engine, no duplication**: `src/lib/purchaseQuantityRules.ts` (`computeQuantityRuleState`, `validatePurchaseQuantityRules`, `formatQuantityViolationMessage`) is imported by both the server (checkout) and the client (cart/checkout UI) — never reimplemented per call site.
- **Authoritative enforcement**: `/api/checkout` and `/api/checkout/external-link` validate product-rule and group-rule independently before creating any order/PaymentIntent. The cart can stay temporarily invalid while being built; checkout never can.
- **Client-side pre-gates** (UX only, not a substitute for server validation): `CartPurchaseClient.tsx` disables its "Continuer" buttons, and `CheckoutForm.tsx` blocks both the address→payment step transition and the moment right before rendering `StripePaymentStep` — needed because Stripe's deferred-intent flow renders the payment form before any PaymentIntent/validation exists, so reaching that page does not by itself mean the cart is valid.
- **Cart UX**: `cartStore.ts`'s `addItem`/`incrementItem`/`decrementItem` snap to the minimum/step (decrementing below the minimum removes the line rather than leaving an invalid quantity); `QuantityGroupProgress.tsx` (fed by public `GET /api/quantity-groups`) shows live progress for touched groups.
- **One product card, one data shape**: every `products` query feeding a card uses the shared projection `src/lib/catalog/productCardSelect.ts` (`PRODUCT_CARD_SELECT`); `ProductCardProduct.min_order_quantity/order_quantity_step` are required (not optional) fields on purpose, so a data source that forgets to populate them fails to compile. `match_products` (the semantic-search RPC, migration `122_match_products_quantity_rules.sql`) returns these columns directly — extending it requires `drop function` before `create` since Postgres rejects a `create or replace` that changes the return columns.
- **Nala** (`src/lib/ai/nalaProductActionContract.ts`, `nalaCartPlanContract.ts`/`nalaCartPlanResolver.ts`) proposes/adds the real minimum quantity, never a literal `1`, and drops a candidate whose stock can't cover its minimum instead of proposing an unpurchasable quantity.
- **Admin**: product editor "Règles de vente" section (min/step) and `/admin/catalogue/quantity-groups` (+ `api/admin/catalogue/quantity-groups/**`) for group CRUD and membership.

### Shipping Calculation (`src/lib/shipping/calculateShipping.ts`)

The shipping logic is the most complex part of the codebase:

- Fetches `packaging_surcharges` and `shipping_vat_rates` from Supabase for the tenant
- Calls Packlink PRO API; filters to home delivery only (no dropoff, no B2B)
- Splits cart into parcels: `num_parcels = ceil(total_weight_g / (max_pack_kg × 1000))`
- `shippingTotal = packlink_base_price + vat + (surcharge_amount × num_parcels)`
- Selects the cheapest eligible service; detailed breakdown is hidden from the customer UI

### Storefront Caching

- `getTenant()` (60 s), shop categories / category previews / catalogue ranking IDs (`src/lib/catalog/catalogCache.ts`, 60–300 s) and the shop-layout display data (`getShopShellData`, 300 s) live in the Next.js Data Cache, tagged via `src/lib/cache/storefrontCache.ts`. Product rows (price, stock) are always read fresh — the cache only decides the order.
- `(shop)/layout.tsx` must never read cookies/session: that would make every shop page dynamic again and disable ISR on `/products/[slug]`, `/accueil` and `/avis`. Per-customer UI (e.g. `ActiveCheckoutRecovery` → `GET /api/checkout-sessions/active`) is resolved client-side.
- Any admin route that writes tenant, catalogue, social links, review moderation or review/feature settings wraps its handlers with `withStorefrontInvalidation([...scopes], handler)` so changes appear immediately; the TTLs only bound staleness for writers that forget.
- `public/sw.js` is network-only (no `fetch` handler): it must not proxy or cache HTML, RSC payloads or Next.js chunks.

### Assisted orders (WhatsApp / phone / Instagram / in-store) — `docs/ASSISTED_ORDERS.md`

- A staff-entered purchase is a `checkout_sessions` row with `origin = 'assisted'` (`draft → open (/pay/[token]) → awaiting_verification → completed`); **no `orders` row exists before payment is confirmed**. Customer-facing recovery code must keep filtering `origin = 'storefront'`.
- Every conversion (assisted Stripe webhook `metadata.type = assisted_preorder`, manual confirmation, "Déjà payé") goes through `src/lib/orders/convertCheckoutSessionToOrder.ts` → RPC `convert_checkout_session_to_order` (migration 128): row lock + order/items/stock in one transaction, unique `orders.checkout_session_id`; side effects run only when `created = true`.
- `orders.email` can be null for assisted orders: never assume an email; tracking tokens are `HMAC(orderId + (email ?? ''))`.

### Order documents & QR portal — `docs/ORDER_DOCUMENTS.md`

- Two separate renderers on one batch loader (`src/lib/orders/documents/`): internal **liste de préparation** and customer **bon de colis**. The slip only ever receives `CustomerOrderDocumentViewModel` (built field by field — never the `orders` row, never warehouse locations, notes, e-mail, phone, payment or UUID).
- Server PDF via Gotenberg (`htmlToPdf(html, options)` in `src/lib/labels/gotenberg.ts`, options are additive) is the only print path: `GET /api/admin/orders/[id]/documents/{picking-list|packing-slip}` and bulk `GET /api/admin/orders/documents/{kind}?ids=` (`orders.view`, one PDF, max 50). Formats come from `ORDER_DOCUMENT_FORMATS` (A5 default, A4) — never hard-code `'a5'`/`'a4'` elsewhere. Tenant defaults live in `tenant_feature_settings('order_documents')` (migration 145).
- The QR targets `<storefront_url>/o/<token>`: opaque 128-bit HMAC token, only nonce + SHA-256 stored in `order_public_access_tokens` (service role only), created lazily, same token on reprint, revocable. The `/o/[token]` portal shows a minimal view-model (no PII, persisted tracking snapshot only); reorder is a read-only proposal added through the normal cart.

### WhatsApp Business channel (multi-tenant) — `docs/WHATSAPP_BUSINESS_PLATFORM.md`

- One public webhook for all tenants: `/api/integrations/whatsapp/webhook` (GET verify token, POST `X-Hub-Signature-256`, fail closed). The tenant is resolved **only** from `metadata.phone_number_id` → `tenant_whatsapp_channels` (migration 147), never from the customer number, a client-sent id or `NEXT_PUBLIC_TENANT_SLUG`. Processing code reads the tenant row by id and builds links from `tenants.storefront_url` only (never `NEXT_PUBLIC_APP_URL`).
- Graph API is called only from `src/lib/whatsapp/provider/metaCloudProvider.ts`; every outbound message goes through `responseService.ts` (24 h window, test-tenant allow-list `WHATSAPP_TEST_RECIPIENTS`). Tokens never in DB: `access_token_env` stores an env var NAME, default `META_WHATSAPP_SYSTEM_USER_TOKEN`.
- Inbound messages are persisted idempotently (RPC `ingest_whatsapp_inbound_message`) then processed via atomic claim (`claim_whatsapp_inbound_messages`), inline or through n8n (`WHATSAPP_PROCESSING_MODE`); n8n only carries UUIDs.
- Deterministic rules (`lib/whatsapp/automation/`) win over AI; payments, orders, shipping costs, stock and tracking never come from Nala. Nala runs as a channel via `lib/ai/nalaChannelTurn.ts` — do not create a second assistant. A conversation in `waiting_human`/`human` has `automation_status = paused`: automation must never reply.
- Behind release flag `whatsapp_business`; pages call `requireWhatsAppPage()`, APIs `requireWhatsAppApi()` (`lib/whatsapp/server/featureGate.ts`). Capabilities `whatsapp.view|reply|manage`; mapping a `phone_number_id` to a tenant is platform-owner only.

### Internal notification recipients — `docs/NOTIFICATION_SUBSCRIPTIONS.md`

- Notification types are a code catalogue (`src/lib/notifications/notificationTypes.ts`: `NOTIFICATION_TYPES`, groups, presets); the DB stores only `tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel)` (migration 143). Adding a type = one registry entry, never a new `notify_*` column (those are legacy, backfilled by 143).
- Senders call `getNotificationRecipients(db, tenantId, '<type_key>')` (or `sendTenantEmail({ recipientFlag })`) → RPC `notification_recipient_emails`, which also drops recipients linked (`admin_user_id`) to an inactive admin/membership.
- All subscription edits go through `POST /api/admin/notification-recipients/subscriptions` (batch of `{ recipientId, typeKey, subscribed }`); types of disabled modules (`events_enabled`) are hidden in the UI but their subscriptions are preserved.

### Subscription lifecycle and suspension — `docs/SUBSCRIPTION_LIFECYCLE.md`

- One engine: `lib/billing/tenantServiceState.ts` (`getTenantServiceState`, `isModuleAvailable`, `guardModule`). Suspended = manual (`tenant_subscriptions.status = 'suspended'`) or automatic past `paid_until + grace_days`, computed at read time; per-module suspension in `tenant_module_suspensions`. Fail-open without migration 144.
- A new public write API (checkout, payment, reservation, inquiry) must call `guardModule(tenant.id, '<module>')` before creating anything; webhooks never do. Public layouts render `ServiceSuspendedPage`; the shop layout stays cookie-free.
- Subscription writes only through the 144 RPCs (`record_tenant_subscription_payment`, `admin_update_tenant_subscription`); the renewal rule lives in SQL, mirrored in `lib/billing/subscriptionRules.ts`.

### Nala Analytics — `docs/NALA_ANALYTICS.md`

- `/admin/nala-analytics` (entitlement `nala_analytics`, `ai_usage.view`) reads `nala_sessions` / `nala_interactions` / `nala_conversion_events` through `lib/admin/nalaAnalyticsDashboard.ts`; pure rules in `lib/admin/nalaAnalyticsRules.ts`.
- Customer message excerpts shown to admins always go through `redactMessage` (truncated, e-mails/phones masked, never the customer identity). Assisted revenue counts only paid, non-cancelled, non-test orders.
- 90-day retention is enforced by `POST /api/internal/nala-analytics-purge` (`NALA_ANALYTICS_PURGE_CRON_SECRET`, n8n `ops/n8n/nala-analytics-purge.json`).

### Ambassador program — `docs/AMBASSADOR_PROGRAM.md`

- Real-money commission on the first **delivered** order of each customer invited by an ambassador (`customers.is_ambassador`, admin-only); computed in SQL by `process_ambassador_commission_atomic` (046/051), parameters historised per row, one commission per referred customer (unique).
- Settings are written only by `PATCH /api/admin/ambassador/settings`, validated by `ambassadorSettingsIssues` (`lib/ambassador/ambassadorAdmin.ts`); never re-add the `ambassador_*` fields to `/api/admin/tenant`.
- Payouts are manual and recorded per ambassador (`POST /api/admin/ambassador/payouts`, `growth.payouts.manage`, refused for incomplete profiles); bank details are loaded only for that permission. Commissions move only `CONFIRMED → PAID | CANCELLED`, never deleted.

### Gestion du commerce (suppliers, purchases, stock ledger, treasury) — `docs/BUSINESS_MANAGEMENT.md`

- Admin domain under `/admin/gestion/**` + `/api/admin/gestion/**`, behind the release flag `business_management` (`tenant_feature_flags`). Every page calls `requireBusinessManagementPage()` and every handler `requireBusinessManagementApi()` (`lib/gestion/featureGate.ts`); flag off/unreadable = 404. Hiding the sidebar entry is not the security control.
- Schema from migration 139: every cross-entity reference is a composite FK `(tenant_id, id)`; RLS without policies, service-role only, no DELETE on financial/audit tables (reverse or void instead). Balances are never stored: read `supplier_purchase_financials` / `supplier_balances`.
- Only allocations of **verified** payments reduce supplier debt. `products.stock` stays the canonical storefront stock; a receipt increments it and writes `inventory_movements` in the same RPC transaction.
- Writes go through `RETURNS TABLE (out_*)` RPCs with a per-tenant request key (idempotent retries); errors are `raise exception '<code>'` mapped to French messages in `lib/gestion/errors.ts`.
- Procurement quantities are `numeric(14,3)` with a purchase unit and a stock conversion; `products.stock` stays an integer and a receipt must convert to whole stock units (rejected otherwise, never rounded). Use `lib/gestion/quantity.ts` (BigInt) for quantity math, never JS floats. Purchase costs live only in the server-only `product_costs` / `product_cost_history` tables (last received cost per stock unit), never on `products` or in client payloads.

### State Management

Cart state lives in Zustand (`src/stores/cartStore.ts`), persisted to `localStorage` under key `lepefy-cart`. No other global client state.

### Cross-device cart sync

For **authenticated** customers the cart is mirrored server-side (`carts` table) with optimistic concurrency control. Guest carts stay purely in `localStorage` — zero network calls.

- Store actions enqueue **typed mutations** (`add` relative / `set_quantity` absolute / `remove` / `clear`) into `cartStore.pendingMutations`, persisted alongside the items. The UI never waits for the network.
- `src/lib/cart/cartSyncEngine.ts` owns all sync logic (debounced flush, retry/backoff, offline queueing, 409 reconciliation, login merge). `CartSyncProvider` only wires lifecycle events (auth, online/offline, visibility, pagehide).
- `POST /api/customers/me/cart` sends `{ expectedVersion, mutations }`; the server applies them atomically via the `apply_cart_mutations` RPC (migration `070_cart_versioning.sql`) and returns the canonical `{ items, version }`. A stale version yields **409** with the canonical state, never an overwrite.
- Full details, conflict-resolution strategy and manual test procedure: `docs/CART_SYNC.md`.

### Supabase Clients

Two separate clients exist — use the right one:
- `src/lib/supabase/client.ts` — browser client (for client components)
- `src/lib/supabase/server.ts` — server client using cookies (for Server Components and API routes)

### Admin

`/admin` routes are protected via **Supabase Auth** (email/password) implemented at the Server Component layout level (Edge middleware is not used due to Vercel monorepo limitations).

**Route structure** (`src/app/admin/`):
- `layout.tsx` — HTML shell only (CSS vars from tenant, no auth check); wraps all admin routes including login
- `(protected)/layout.tsx` — auth check via `createServerClient` + `cookies()`; looks up the caller in `admin_users` (`id`, `role`, `tenant_id`, `active`); wraps dashboard, orders, and every other route in the group. Passes `isPlatformOwner={admin.role === 'platform_owner'}` to `AdminHeader`/`AdminSidebar` so platform-only nav items (e.g. "Équipe") only render for that role.
- `(protected)/page.tsx` — order management dashboard (`/admin`)
- `(protected)/orders/[id]/page.tsx` — per-order detail/picking list (`/admin/orders/:id`)
- `(protected)/team/page.tsx` + `TeamClient.tsx` — platform-only admin user management (`/admin/team`): lists every `admin_users` row across all tenants, invites new admins, activates/deactivates existing ones. The page does its own extra `role !== 'platform_owner'` check (`redirect('/admin')`) on top of the group's auth check — never accessible to `tenant_admin`/`tenant_cashier`.
- `login/page.tsx` — login form, Client Component; calls `POST /api/admin/login` (server-side) then `router.refresh()` + `router.push('/admin')`; reads `?error=unauthorized` to show access-denied message
- `accept-invite/page.tsx` — Client Component, **outside** the `(protected)` group (same reason as `loyalty/scan`/`evenementiel/scan`: reachable before the user has a verifiable `admin_users` row). Landing page for the Supabase invite email link; waits for `detectSessionInUrl` to exchange the link's token, then lets the invited user set a password via `supabase.auth.updateUser({ password })`, then redirects to `/admin/login`.
- `LogoutButton.tsx` — logout button (Client Component) rendered in `(protected)/layout.tsx`

**Auth flow**: unauthenticated → `redirect('/admin/login')`; authenticated but not an active row in `admin_users` → `redirect('/admin/login?error=unauthorized')`.

**Roles & `admin_users`** (`supabase/migrations/039_admin_users.sql`, extended by `047_loyalty_card_system.sql`): `role` is one of `platform_owner` (global access, `tenant_id` null), `tenant_admin` (full access scoped to one tenant), `tenant_cashier` (scoped like `tenant_admin` but redirected to `/admin/loyalty/scan` only). `lib/auth/requireAdmin.ts` is the guard every admin API route must call: `platform_owner` always passes; other roles need both to be in the route's `allowedRoles` list (default `['tenant_admin']`) **and** to match the route's `tenantId`. Passing `allowedRoles: []` restricts a route to `platform_owner` only, regardless of `tenantId` — used by `api/admin/team/*` since team management is platform-only. `admin_users` has no public RLS policy; only `service_role` (via `createServiceClient()`) can read/write it.

**Inviting admins** (`/admin/team`, platform_owner only): `POST /api/admin/team/invite` calls `createServiceClient().auth.admin.inviteUserByEmail(email, { redirectTo: '.../admin/accept-invite' })`, then upserts the corresponding `admin_users` row (manual `select` + `insert`/`update`, never `.upsert()` with `onConflict` — the email uniqueness index is on `lower(email)`, an expression index, not a plain column). If the invite fails because the auth user already exists, the route looks it up via `auth.admin.listUsers()` (paginated) and reuses that id — this also doubles as the path to re-invite someone or change an existing admin's role/tenant. `PATCH /api/admin/team/[id]` only ever toggles `active` (deactivate/reactivate) — there is no delete; both routes reject an admin trying to act on their own id where relevant (self-deactivation).

**Cookie API**: `@supabase/ssr@0.3.x` uses `get(name)`/`set(name,value,options)` internally (old API). Every `createServerClient` instance (API routes, protected layout, `team/page.tsx`) must provide `get + set + remove + getAll + setAll` — providing only `getAll/setAll` causes session read/write to silently fail.

**Login flow**: `POST /api/admin/login/route.ts` calls `signInWithPassword` server-side and sets session cookies explicitly on the `NextResponse`. This ensures cookies are available to Server Components on the next request.

Beyond the `/admin/team` invite flow above, there is still no self-service registration; the very first `platform_owner` account is created manually via **Supabase Dashboard → Authentication → Users** + a row in `admin_users`.

## Key Environment Variables

```bash
# Public (safe in browser)
NEXT_PUBLIC_TENANT_SLUG=chloefood
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_APP_URL=

# Server-only (never expose to client)
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
PACKLINK_API_KEY=
ADMIN_EMAILS=email1@example.com,email2@example.com  # comma-separated, no spaces

# WhatsApp Business channel (docs/WHATSAPP_BUSINESS_PLATFORM.md §9)
META_WHATSAPP_VERIFY_TOKEN=          # webhook GET verification (random, chosen by us)
META_APP_SECRET=                     # Meta App Secret (X-Hub-Signature-256), comma-separated for rotation
META_WHATSAPP_API_VERSION=           # Graph API version, default v23.0
META_WHATSAPP_SYSTEM_USER_TOKEN=     # permanent System User token (never the temporary token in prod)
WHATSAPP_PROCESSING_MODE=inline      # inline | n8n
WHATSAPP_INTERNAL_SECRET=            # bearer for /api/internal/whatsapp/* (n8n)
WHATSAPP_TEST_RECIPIENTS=            # test tenants only: allowed recipients, digits, comma-separated
```

## Conventions

- **Locale**: All UI strings are in **French** (`fr-FR`), currency EUR
- **Icons**: Use `@tabler/icons-react` exclusively
- **Forms**: React Hook Form + Zod validation
- **Routing**: Next.js App Router; customer-facing pages live under `src/app/(shop)/`, API routes under `src/app/api/`
- **Types**: Shared domain types live in `packages/types/`; import as `@lepefy/types`
- The `packages/types/shipping.ts` `ShippingZone`/`ShippingRate` types are legacy and not used — the active shipping config is in the DB tables `packaging_surcharges` and `shipping_vat_rates`
