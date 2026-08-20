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

There is no test suite yet. Type-checking is the primary correctness check:
```bash
cd apps/storefront && pnpm typecheck
```

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
2. Root layout (`src/app/layout.tsx`) calls `getTenant()`, applies CSS custom properties from tenant config, and wraps the tree in `TenantProvider`
3. All Supabase queries filter by `tenant_id` — enforced both in application code and via Supabase RLS policies (`supabase/migrations/002_rls_policies.sql`)

### Data Flow: Checkout

```
Cart (Zustand, localStorage)
  → /checkout page
    → POST /api/shipping/quote  (Packlink API → cheapest rate + VAT + surcharge)
    → POST /api/checkout        (creates order + Stripe PaymentIntent or in-store order)
  → /order-confirmation
```

### Shipping Calculation (`src/lib/shipping/calculateShipping.ts`)

The shipping logic is the most complex part of the codebase:

- Fetches `packaging_surcharges` and `shipping_vat_rates` from Supabase for the tenant
- Calls Packlink PRO API; filters to home delivery only (no dropoff, no B2B)
- Splits cart into parcels: `num_parcels = ceil(total_weight_g / (max_pack_kg × 1000))`
- `shippingTotal = packlink_base_price + vat + (surcharge_amount × num_parcels)`
- Selects the cheapest eligible service; detailed breakdown is hidden from the customer UI

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
```

## Conventions

- **Locale**: All UI strings are in **French** (`fr-FR`), currency EUR
- **Icons**: Use `@tabler/icons-react` exclusively
- **Forms**: React Hook Form + Zod validation
- **Routing**: Next.js App Router; customer-facing pages live under `src/app/(shop)/`, API routes under `src/app/api/`
- **Types**: Shared domain types live in `packages/types/`; import as `@lepefy/types`
- The `packages/types/shipping.ts` `ShippingZone`/`ShippingRate` types are legacy and not used — the active shipping config is in the DB tables `packaging_surcharges` and `shipping_vat_rates`
