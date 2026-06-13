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

### Supabase Clients

Two separate clients exist — use the right one:
- `src/lib/supabase/client.ts` — browser client (for client components)
- `src/lib/supabase/server.ts` — server client using cookies (for Server Components and API routes)

### Admin

`/admin` routes are protected only at the UI level (no auth yet). `src/app/admin/` contains an order management dashboard and per-order picking lists. API mutations go through `src/app/api/admin/`.

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
```

## Conventions

- **Locale**: All UI strings are in **French** (`fr-FR`), currency EUR
- **Icons**: Use `@tabler/icons-react` exclusively
- **Forms**: React Hook Form + Zod validation
- **Routing**: Next.js App Router; customer-facing pages live under `src/app/(shop)/`, API routes under `src/app/api/`
- **Types**: Shared domain types live in `packages/types/`; import as `@lepefy/types`
- The `packages/types/shipping.ts` `ShippingZone`/`ShippingRate` types are legacy and not used — the active shipping config is in the DB tables `packaging_surcharges` and `shipping_vat_rates`
