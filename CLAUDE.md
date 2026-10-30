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
The responsive storefront confirmation suite (`apps/storefront/tests/confirmation/`, `pnpm test:confirmation`) targets a local `next start` on 127.0.0.1:3100 by default (run `pnpm build` first): provider keys emptied, non-GET `/api` calls intercepted, synthetic user agent/header. Production gets only `CONFIRMATION_SUITE=smoke PLAYWRIGHT_BASE_URL=https://shop.chloefood.com` (4 read-only checks); the full suite against a remote URL needs `CONFIRMATION_ALLOW_REMOTE_FULL=1` (manual `workflow_dispatch` only). Do not run the full suite against production after a push.

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

`/order-confirmation?payment_intent=…` reads the order through `POST /api/checkout-sessions/[id]/order` (session access token returned by `/api/checkout`, or the logged-in owner; `pending` until the webhook creates the order; reduced view `lib/orders/confirmationView.ts`, never the address beyond postal code/city/country). The checkout keeps `{sessionId, accessToken}` in the tab's sessionStorage keyed by PaymentIntent (`lib/checkout/confirmationAccess.ts`), never in the URL; without it the page falls back to the logged-in RLS read, then a generic message. The anon client can't read `orders` for a guest (RLS `orders_select_own`).

### Purchase Quantity Rules (minimum + step, per product and per combinable group)

`products.min_order_quantity` / `products.order_quantity_step` (migration `121_purchase_quantity_rules.sql`, default `1`/`1` — no behavior change until a tenant configures otherwise) express a generic rule: quantity `q` is valid iff `q >= minimum AND (q - minimum) % step == 0`. The same migration adds `purchase_quantity_groups` / `purchase_quantity_group_products` for an aggregate minimum across a combinable group of products (e.g. a "Boissons" group with minimum 12, any mix of member products counting toward the total) — group membership is explicit, never derived from `categories`.

- **Single engine, no duplication**: `src/lib/purchaseQuantityRules.ts` (`computeQuantityRuleState`, `validatePurchaseQuantityRules`, `formatQuantityViolationMessage`) is imported by both the server (checkout) and the client (cart/checkout UI) — never reimplemented per call site.
- **Authoritative enforcement**: `/api/checkout` and `/api/checkout/external-link` validate product-rule and group-rule independently before creating any order/PaymentIntent. The cart can stay temporarily invalid while being built; checkout never can.
- **Client-side pre-gates** (UX only, not a substitute for server validation): one hook, `src/lib/cart/useCartPurchaseGate.ts` (same engine as the server + stock check). `CartPurchaseClient.tsx` disables its "Livraison et paiement" buttons; `CheckoutFlow.tsx` shows the blocking issues with a link back to the cart, disables "Choisir le paiement" and the payment CTA, and its Stripe `createIntent` returns the issue instead of calling `/api/checkout` — needed because Stripe's deferred-intent flow renders the payment form before any PaymentIntent/validation exists, and `/checkout` can be reached without the cart page (direct URL, history, cart changed in another tab).
- **One +/− transition everywhere**: `stepPurchaseQuantity(current, min, step, stock, direction)` in the engine (0 → minimum, then +step; − at the minimum returns 0 = remove the line, never a state below the minimum). `cartStore.incrementItem`/`decrementItem` (returns `'decremented' | 'removed' | 'unchanged'`) are its only callers; `addItem` is the first add. Every control renders `components/cart/CartStepper.tsx` fed by `lib/cart/useCartLineQuantity.ts`: product card once in the cart (grid and shelf, not Goodies), PDP once in the cart, cart page/drawer lines, add-to-cart confirmation. At the minimum the − is a trash "Retirer … du panier" (cart page/drawer keep the 5 s undo). Store actions are synchronous on Zustand state, so rapid clicks never act on a stale quantity. `cartLineIssue` (`lib/storefrontCopy/availability.ts`) offers "Passer à N" (`repairQuantity`) for over-stock or off-rule saved quantities. `QuantityGroupProgress.tsx` (fed by public `GET /api/quantity-groups`) shows live progress for touched groups; group rules are never derived from a product's own rule.
- **One product card, one data shape**: every `products` query feeding a card uses the shared projection `src/lib/catalog/productCardSelect.ts` (`PRODUCT_CARD_SELECT`); `ProductCardProduct.min_order_quantity/order_quantity_step` are required (not optional) fields on purpose, so a data source that forgets to populate them fails to compile. `match_products` (the semantic-search RPC, migration `122_match_products_quantity_rules.sql`) returns these columns directly — extending it requires `drop function` before `create` since Postgres rejects a `create or replace` that changes the return columns.
- **Nala** (`src/lib/ai/nalaProductActionContract.ts`, `nalaCartPlanContract.ts`/`nalaCartPlanResolver.ts`) proposes/adds the real minimum quantity, never a literal `1`, and drops a candidate whose stock can't cover its minimum instead of proposing an unpurchasable quantity.
- **Admin**: product editor "Règles de vente" section (min/step) and `/admin/catalogue/quantity-groups` (+ `api/admin/catalogue/quantity-groups/**`) for group CRUD and membership.

### Promotions, novelties and the mobile cart (migration 156)

- **Promotions = the existing `compare_at_price`**: one pure rule in `src/lib/catalog/promotions.ts` (`hasValidPromotion`, `promotionDiscountPercent`, `isActivePromotion` = valid strikethrough AND purchasable for stock/minimum; also used by the `/card` showcase). `getActivePromotions(supabase, tenantId, shopCategoryIds)` always filters `tenant_id`, `active`, shop categories and `compare_at_price is not null`, read fresh (never cached), sorted by discount; a read error returns `[]`. `isActivePromotion` also drops a running scheduled promo whose end has passed (before the tick runs).
- **Scheduled promotions** (migration `156_product_promotions_novelties.sql`): `products.price` is ALWAYS the price paid — no reader computes a price. `promo_price` / `promo_starts_at` / `promo_ends_at` / `promo_until_sold_out` describe a schedule; while it runs `price = promo_price`, `compare_at_price = regular price`, `promo_applied = true`; at the end the regular price is restored and the `promo_*` columns are cleared. Undated manual promos (`compare_at_price` set, `promo_price` null) are never touched. Who flips: the admin save computes the current state (`lib/catalog/promotionSchedule.ts` `resolvePricingColumns`, same rule as SQL; the editor sends one `pricing` object, the legacy `price`/`compare_at_price` keys are refused with 409 while a schedule exists); date transitions run in SQL `apply_product_promotion_schedule()` (service role only, idempotent, all tenants) called by `POST /api/internal/catalog-schedule` (n8n every 5 min, `ops/n8n/catalog-schedule.json`, bearer `CATALOG_SCHEDULE_SCHEDULER_TOKEN`, never the service-role key); "jusqu'à épuisement des stocks" ends in the BEFORE UPDATE OF stock trigger `products_end_sold_out_promotion` (stock below the purchase minimum, same transaction as the checkout decrement, so a restock comes back at the regular price). Display: `promotionEndLabel` ("Jusqu'au sam. 31 oct. ou épuisement des stocks"), Paris time (`lib/time/shopTime.ts`). Promo fields are audited in `catalog.product.price_updated`.
- **Novelties**: `products.new_until` (`lib/catalog/novelties.ts`); the tick clears past dates, so cards read the data only (no client clock, no hydration mismatch) and server lists also filter `new_until > now`. `NoveltyBadge` ("Nouveau"), catalogue shelf "Nouveautés" and `/?new=1` (exclusive with `?promo=1`), Découvrir row "Nouveautés" when any (otherwise "Sélection du moment"); the created-at sort is labelled "Derniers ajoutés". Admin: editor sections Promotion / Nouveauté (`ProductHighlightsSection.tsx`, 7/14/30 days), list filters "Mise en avant" (`promo`, `promo_scheduled`, `novelty`). `PRODUCT_CARD_SELECT` includes `promo_applied, promo_ends_at, promo_until_sold_out, new_until`: migration 156 must be applied before the code is deployed.
- **Catalogue**: no promo/novelty access in the header (search stays first). On the unfiltered catalogue: shelf "🔥 Nos promos" then shelf "✨ Nouveautés" (`components/catalog/CatalogShelf.tsx`, max 10 cards each, a product both in promo and new only in the promo shelf), each with a "Tout voir N" pill button (red / violet, total count) to `/?promo=1` / `/?new=1` (all items, no pagination, sort hidden, "← Tout le catalogue" button, empty state). "Tous les produits" leaves out the products shown in the shelves: `excludeIds` is passed to `getCatalogPage` and `/api/products?exclude=` (UUIDs only, max 20, ignored with a search/category/group) and removed BEFORE page slicing (`prioritizedCatalogIds(..., excludedIds)` on the ranking path, `not id in` on the fallback query), so infinite scroll has no gap or repeat. With a search, category, group or full view: no shelf, no exclusion. `buildCatalogUrl({ promo })` — a search or category leaves the promo view. Cards, PDP, confirmation and search suggestions use `PromoBadge` ("Promo −14 %", always written, never colour-only) + the strikethrough price. The scrolling ticker stays on `/accueil` only.
- **Cart page** (`app/(shop)/cart/`): part of the app navigation, unlike checkout. Mobile: the commercial header is hidden (`isCartPath` → `max-md:hidden` in `Header.tsx`) and replaced by `CartPageHeader`: sticky row "← Continuer mes achats" written out (→ `getShoppingReturn()` + `markShoppingReturn()`, never browser history) + "N produits", the cart search below it, then a non-sticky h1 "Mon panier". The BottomNav stays on `/cart` (empty or not; `shouldShowBottomNav(pathname)` hides it only on checkout and `/avis/donner`); `CartCheckoutBar` (one row: live "Sous-total", "Livraison et paiement", "Livraison calculée à l'étape suivante" below) is fixed just above it (`bottom: calc(4rem + env(safe-area-inset-bottom))`) and reserves its own height as body padding; the removal undo shows inside it. `CartProductSearch` (below `lg`) sits inside the sticky `CartPageHeader` (always reachable) and reuses the global search engine `components/search/useProductSuggestions.ts` (never a second fetch/cache) with `{ similar: true }`: `/api/products?similar=1` adds `similar` (typo-tolerant names, `lib/catalog/similarProductSearch.ts` pure Damerau-Levenshtein ranking + `similarProducts.ts`, only when exact `ilike` results < limit, page 1, no category/group; no AI, no migration). Results open in a panel limited to the visible area (above the keyboard or the `[data-bottom-chrome]` bars): name → PDP, "Ajouter N" via `useQuickAdd` then the same `CartStepper`; Enter only closes the keyboard. `hooks/useVirtualKeyboard.ts` (visualViewport) drives `cartUiStore.cartSearchActive`: BottomNav and bar hide only while the keyboard is open, and when it closes (Android back, iOS gesture) the field is blurred so the nav comes back without a tap. Lines (`CartItem` variant `page`): independent cards (`<ul className="space-y-3">` on a background tinted 4 % with `--color-primary`), product area (image + name → PDP, `orderLineDetail`, availability/fulfillment) then an action area (`CartStepper` variant `cart` + "Total"). One remove action only: the stepper's − becomes a red trash at the minimum (same size, no layout shift); a blocked line (unavailable / no stock for the minimum) offers only that trash, and its removal shows no undo (it could not come back). The `drawer` variant and the `line`/`card`/`panel` stepper variants are unchanged. `shopChrome.ts`: `shouldShowSearchBar` hides the sticky global search on `/cart`. Cart-dependent chrome is decided after mount (`hooks/useHasMounted.ts`) so the first render matches the server HTML. The CTA always goes to `/checkout`, which re-runs every validation. `CartPromoReminder` (count from the cart page server component) sits after the items, never in the action bar. Continuous shopping below the cart (empty or not), `components/cart/CartCatalogSection.tsx`: order = items, cart notices (groups, fulfillment), promo reminder, "Complétez votre panier" (`GET /api/cart/suggestions?ids=` — real data only, by priority: `product_relationships` type `complementary` of the cart products (service role, tenant-scoped), `getActivePromotions`, `sort=bestsellers` ranking (falls back to catalogue order); shop categories, purchasable, not in the cart; pure rule `lib/cart/cartSuggestionRules.ts`; fetched once per visit so it never reorders under the finger; shown with `CatalogShelf`, whose "Tout voir" link is optional) then "Tous les produits" (tenant category chips, `ProductCard` grid 2/3 columns, 4 when full width) paged by the hook shared with `CatalogClient`, `lib/catalog/useInfiniteProducts.ts` (pages of 12 via `/api/products`, sync guard, abort, dedup, retry; starts only near the viewport, after the suggestions so `exclude=` removes them before slicing — no gap/repeat). Cards use `confirmOnAdd={false}` (no add confirmation, no drawer): the CTA becomes the shared stepper, subtotal and BottomNav badge update, and `keepInPlace` holds the tapped card under the finger while the cart above grows. Back from a product page: `lepefy-cart-catalog` (sessionStorage: category, pages, scroll) reloads the same pages fresh and restores the position. `MAX_EXCLUDED_IDS` lives in `lib/catalog/catalogLimits.ts` (client-safe; `pagination.ts` pulls server code).
- **BottomNav colours** (`components/layout/BottomNav.tsx`, palette `lib/storefront/bottomNavTheme.ts`, unit-tested): three separate functions — colour recognises the destination (Découvrir teal, Catalogue blue, Goodies amber, Compte desaturated violet, Panier = tenant `primary_color` darkened in its own hue until ≥ 4.5:1 on white via `ensureContrastOnWhite`; `resolveBottomNavPalette` swaps a destination to its next candidate when its hue is within 30° of the cart or of an already coloured destination, e.g. a blue tenant gets a pink Catalogue), the active state orients (tinted pill of constant size + thicker stroke + bold coloured label + `aria-current`, never colour alone; inactive labels `#374151`), the badge tells the cart content (secondary colour, `readableOn`). The cart stays easy to spot: a 44 px disc in the tenant colour (tinted with a ring when inactive, solid on `/cart` = active), taller than the other pills but inside the bar (labels bottom-aligned, nothing over a product page buy bar); its pop plays only after a real add (`useCartAddPulse`). The hamburger menu (`BrandNavigationDrawer`, shop and events headers) uses the same palette through `resolveNavigationPalette` (extra roles `services` for events/catering, `contact` for map/message; orders and card/payment in the cart colour; neutral stone as last resort) and the same active pattern (tinted row, bold coloured label, thicker stroke, `aria-current`). Platform colours, no DB column.
- **Return to the catalogue**: `shoppingReturn.ts` — `CatalogClient` records its URL (incl. `?page=N`, `promo`) and scroll position while shown; "Continuer mes achats" / PDP "Retour" call `markShoppingReturn()` and the position is restored once, only for the same URL (`takeCatalogScrollRestore`).

### Petits plus and flat-rate headroom in the cart (migration 165)

- **Petits plus**: impulse products chosen and ordered by the shop (`products.add_on_position`, NULL = not one; written only by RPC `set_product_add_ons`, full list, atomic, max 40) at `/admin/catalogue/petits-plus` (`GET/PUT /api/admin/catalogue/add-ons`). Not a `tenant_feature_settings` list (module config never holds relational lists). `/api/cart/suggestions` source order: complementary of the cart (or of `?anchor=` alone — the add-to-cart confirmation now uses it) → petits plus → promotions → bestsellers (`assembleCartSuggestions`). Reads are fail-open (`isMissingAddOnColumn`): migration absent = empty list.
- **Phase 2 placements**: catalogue shelf « Les petits plus » after Promos/Nouveautés (`getAddOnProducts` in `lib/catalog/addOnShelf.ts`, max 10, products already in a shelf skipped, excluded from « Tous les produits » — `MAX_EXCLUDED_IDS` = 30); PDP block « Pour compléter » (`ProductAddOns`, client-side `?anchor=`, never cart or « Vous aimerez aussi » products, the page stays ISR); checkout delivery step row « Un petit plus ? » (`CheckoutAddOns`, `?only=add_ons`, max 4, « Non merci » per session, never at payment; an add calls `invalidateQuote()` so the quote is recomputed with the new weight).
- **Add sources**: `recordAddSource(productId, 'cart_suggestions' | 'cart_fits' | 'add_confirmation' | 'catalog_shelf' | 'product_page' | 'checkout_delivery')` (the last three need migration 166) → `POST /api/cart/add-source` (always 204) → RPC `record_storefront_add`, aggregated counters `storefront_add_counts` (day × placement × product, no visitor data, service role read-only).
- **Estimate**: `POST /api/shipping/estimate` (tariff mode only, in-memory per-IP limit) = same engine/weights/country rules as the quote, pure `lib/shipping/tariff/shippingEstimate.ts` (`estimateShipping`: price + headroom = grams before the first price rise — band end, block, new parcel when a per-parcel zone surcharge exists — floored to 100 g; unknown postal code → continental price, margin true for every zone). Country: checkout address of the session → explicit choice → account default address → IP if served → shop default (`estimateCountry.ts`). Never expose the grid, costs, band limits or « over by X g ». Cart: one `useShippingEstimate()` in `CartPurchaseClient` (bar, tablet/desktop `CartShippingEstimateDetail` with country selector, « Ça rentre dans votre colis » shelf decided once via `selectParcelFits`); checkout shows the margin only after a quote and only when the estimate equals the quoted price. The paid price always comes from the signed quote.

### Product duplication (admin catalogue, no migration)

- « Dupliquer le produit » (list ⋮ menu, product sheet) and « Créer à partir d'un produit existant » (`/admin/catalogue/nouveau`, `nouveau/DuplicateSourceBar.tsx`, server search through `GET /api/admin/catalogue`) open `/admin/catalogue/nouveau?duplicateFrom=<uuid>`: only the id travels; the page requires `catalog.manage` and re-reads the source with `tenant_id`. Nothing is written before « Créer le produit »: the same `ProductEditClient` and the single `POST /api/admin/catalogue`.
- One field-by-field transform, `lib/catalog/productDuplication.ts` `toDuplicateDraft` (never a row copy): stock 0, inactive, not featured, no promotion of any kind (price = regular price), no novelty, no warehouse location, new slug/barcode; never campaigns, relationships, costs or history.
- `duplicate_from` on the POST: the server reloads the source in the tenant (404 otherwise) and copies `images`/`image_url` from it, never from the body (`duplicate_images: false` drops them). Product image files are immutable and DELETE only detaches, so sharing URLs is safe; the label background (`labels/product-background-<productId>`, overwritten in place) is copied with `storage.copy`.
- Every admin creation gets a unique slug (`productSlugBase` + `nextAvailableSlug`: `base`, `base-2`…), retried on a concurrent `unique(tenant_id, slug)` violation.

### Product fulfillment policy (delivery / pickup per product)

`products.fulfillment_policy` (migration `155_product_fulfillment_policy.sql`): `delivery_or_pickup` (default) | `pickup_only` | `delivery_only`. Separate from `storage_type`, never derived from it.

- **Single pure engine**: `src/lib/fulfillment/fulfillmentPolicy.ts` (`computeCartFulfillment`, `checkFulfillmentMode`) used by server and client. One `pickup_only` forces the whole order to pickup, one `delivery_only` forces delivery, both = incompatible cart; without `tenants.click_collect_enabled` a `pickup_only` product fails closed.
- **Authoritative enforcement**: `validateCheckoutItems(supabase, tenantId, items, { mode, pickupAvailable })` — the 4th argument is required, so every payment path states its mode. Storefront paths pass `tenant.click_collect_enabled`; assisted orders pass `true` (staff-arranged pickup). Errors: `FULFILLMENT_CONFLICT`, `FULFILLMENT_MODE_NOT_ALLOWED`, `PICKUP_NOT_ENABLED` (400, French message, `fulfillment` detail).
- **Client guidance**: `useCartPurchaseGate().fulfillment` (fresh policies from `GET /api/products/fulfillment?ids=`, fail-closed while loading), `CartFulfillmentNotice` on `/cart` and `/checkout`; `CheckoutFlow` only offers allowed modes and forces the single one (invalidating the delivery quote).
- `fulfillment_policy` is part of `PRODUCT_CARD_SELECT` and required on `ProductCardProduct`; `match_products` returns it. Unavailable product images use the shared `UnavailableRibbon` ("pas disponible").

### Shipping Calculation (`src/lib/shipping/calculateShipping.ts`)

The shipping logic is the most complex part of the codebase:

- Fetches `packaging_surcharges` and `shipping_vat_rates` from Supabase for the tenant
- Calls Packlink PRO API; filters to home delivery only (no dropoff, no B2B)
- Splits cart into parcels: `num_parcels = ceil(total_weight_g / (max_pack_kg × 1000))`
- `shippingTotal = packlink_base_price + vat + (surcharge_amount × num_parcels)`
- Selects the cheapest eligible service; detailed breakdown is hidden from the customer UI

### Flat-rate shipping tariffs (forfait) — `docs/SHIPPING_FLAT_RATE_CHECKOUT.md` §12–14

- `shipping_tariff_versions` rows are immutable (trigger 124); `tenants.shipping_pricing_mode = 'tariff'` charges only the `active` version of a country, verified on every payment path (token V2, `checkoutShipping.ts`). A changed version invalidates open quotes with 409 `SHIPPING_REQUOTE_REQUIRED`.
- Tenant page `/admin/livraison/forfait` (`shipping.view`/`shipping.manage`): country cards, quick price editor → `POST /api/admin/shipping-tariff-versions/publish` → RPC `publish_shipping_tariff_version` (migration 159: locks the active base, copies every structural field in SQL, retires the base and activates version `max+1` in one transaction; stale base → 409 `TARIFF_BASE_CHANGED`). Pure helpers in `lib/shipping/tariff/tariffEdit.ts` (French amount parsing, price-only rebuild, diff, country views, history) — never a second pricing engine (`priceFromTariff` stays the only one).
- The forfait laboratory (drafts + rétrotest, version creation from a draft, shadow selection/collection, real-order report) is platform-owner only: pages under `/admin/platform/livraison/{analyse-tarifaire,forfait-laboratoire}`, APIs guarded by `requirePlatformOwner()` and absent from `adminApiPermissions.ts`.

### Engineering Hub (internal technical index, platform owner) — `docs/engineering/README.md`

- Separate bounded context `src/lib/engineering/` (pure indexer + `server/` guard and active-run reader), tables `engineering_*` (migration 175: RLS forced, no policy, service role only, no tenant column), routes only under `/admin/platform/engineering` and `/api/admin/platform/engineering/**` with `requireEngineeringApi` (= `requirePlatformOwner`); absent from `adminApiPermissions.ts`. Never use `canAdmin()` for `engineering.*`.
- `pnpm engineering:index` builds a deterministic snapshot of committed files (TypeScript Compiler API, conservative SQL and Markdown extraction, only demonstrated relations); secrets/personal data/binaries exclude the whole file. Runs are written only while `running`, verified against a manifest, activated atomically (`engineering_activate_run`), rolled back with `engineering_rollback`; the Hub reads only the `active` run. UI (overview/architecture/modules/code/search), search and the AI assistant exist (migration 176: AI off by default — needs BOTH `engineering_settings.ai_enabled` and the `engineering/structured_chat` routing policy; the gateway runs tenant-less only for consumer `engineering` with a usage sink; citations are verified server-side; machine API `/api/engineering/v1/*` with hashed bearer tokens; `docs/engineering/AI_RETRIEVAL.md`). Snapshot upload: `pnpm engineering:sync` / workflow `engineering-sync.yml` → `POST /api/internal/engineering/ingest` (bearer `ENGINEERING_INGEST_TOKEN`, never the service-role key); `pnpm engineering:docs-check` (CI job) fails on invalid or drifted module cards; Metriche page; `docs/engineering/RUNBOOK.md` and `CONTRIBUTING.md`. Engineering scripts run under Node type stripping (no `@/`, enums or constructor parameter properties in the indexer/ingest files).

### Admin Operations V3: Aujourd'hui, Commandes, preparation modes — `docs/ORDER_PREPARATION.md`

- `/admin` is the « Aujourd'hui » dashboard (shop workspace); the orders cockpit lives at `/admin/orders`. `/admin?<ORDER_LIST key>` redirects there — link to `/admin/orders` for anything order-related. Dashboard, list, detail and export all read the single classifier `classifyOrderOperation` (new views `to_prepare`, `to_print`, `paper_in_progress`, `late_preparation`, `tracking_issues`…; the « Contrôles » counts now come from it, mode-aware).
- Preparation modes per tenant: `tenant_feature_settings('order_preparation')` `{ picking_mode, cold_chain_packing_mode }` ∈ `digital | paper | none` (migration 160, default digital), snapshotted on the order (`orders.preparation_mode`) when preparation starts. Every "is it prepared/packed" rule lives in `lib/orders/preparation/preparationPolicy.ts` (`preparationState`, `preparationBlockers`) — never re-derive it in a route or a component. Paper/none never write the digital columns (`picked_at`, `cold_chain_checked_at`, `picking_completed_at`, `cold_chain_packing_checked_at`, `packing_completed_at`); payment, stock, a human-entered parcel count and tracking stay mandatory.
- « Imprimer et démarrer » is `POST /api/admin/orders/preparation/start` (idempotent) followed by the PDF GET — document GETs never mutate. Session de préparation `/admin/orders/preparation?ids=` is stateless; the grouped list is PDF kind `preparation-summary`.
- Reads selecting the 160 columns go through `lib/orders/preparation/compat.ts` fallbacks until the migration is applied.

### Order closure (cancel / handled outside the platform) — `docs/ORDER_CLOSURE.md`

- The only way to cancel an order is `POST /api/admin/orders/[id]/close` → `lib/orders/closure/orderClosureService.ts` (`PATCH status: 'cancelled'` is refused). Status stays `cancelled`; `orders.closure_type` (`cancelled | handled_externally`, migration 161) says whether it is a lost sale. Rules (reasons, allowed communication, carrier guard) live in `closureRules.ts`, shared with the dialog.
- Customer communication is the admin's choice: none, the standard « annulée » email (key `order-cancelled:<id>`), or a custom message (key `order-closure-message:<id>`); `runOrderTransitionSideEffects({ customerEmail: false })` suppresses the standard one. Never change `payment_status`, refund, restock or touch Packlink on closure.
- Statistics: count commercial cancellations as `status = 'cancelled' and coalesce(closure_type, 'cancelled') = 'cancelled'`; an external closure is neither a lost sale nor platform revenue.

### Shipment drafts (provider-neutral, Packlink first) — `docs/SHIPPING_INTELLIGENCE.md` §2.4

- Lepefy only creates an unpurchased provider **draft** (Packlink `POST /v1/shipments`, no `service_id`); purchase stays in Packlink PRO. Never touches customer shipping price, never sets `shipped`, never emails.
- Per-tenant setting `tenant_feature_settings('shipping_automation')` (migration 151): no row = disabled. Triggers `order_created` (Stripe webhook, `convertCheckoutSessionToOrder` when `created = true`, in-store checkout) or `preparing` (first write of `picking_started_at`), or `manual`.
- Order code calls only `requestShipmentDraft` (`lib/shipping/shipmentDraft/shipmentDraftService.ts`): it queues `pending` and never throws or calls the provider. The `/api/internal/shipping-sync` tick (or `POST /api/admin/orders/[id]/shipment/create`) claims with compare-and-set and calls `adapter.createShipmentDraft` (capability `createDraft`).
- Timeouts / 5xx other than 503 / 2xx without reference → `ambiguous`, never auto-retried (Packlink cannot look up by our `LEPEFY-<8>` reference); only 429/503 retry, max 3.
- Parcels = the order's « Carton à utiliser » plan (`planTariffParcels`, tare in gross weight); content = tenant `shipment_content` (migration 152). Lepefy never deletes a provider draft: `.../shipment/release` detaches it only after the provider returns 404/cancelled.

### Storefront Caching

- `getTenant()` (60 s), shop categories / category previews (`src/lib/catalog/catalogCache.ts`, 1 h), catalogue ranking IDs (60 s) and the shop-layout display data (`getShopShellData`, 1 h) live in the Next.js Data Cache, tagged via `src/lib/cache/storefrontCache.ts`. Product rows (price, stock) are always read fresh — the cache only decides the order.
- **ISR pages regenerate at most hourly** (`SHOP_DISPLAY_TTL_SECONDS` = 3600: `/products/[slug]`, `/accueil`, `/card`, `/avis`, legal pages). Next.js 14 renders an ISR page at the SHORTEST of its `revalidate` and every `unstable_cache` read during the render, so the root layout, `(shop)/layout`, `card/layout` and these pages read only display variants: `getDisplayTenant`, `getDisplayTenantServiceState`, `canUseReviews(id, { display: true })` (same tags, so invalidation still hits them). Never call `getTenant()`/`getTenantServiceState()` in that tree (`tests/unit/isrDisplayCache.spec.ts`; the local confirmation suite checks `s-maxage=3600`), and never use a display variant for checkout, payment or a write guard. Stock changed by an order (in-store checkout, Stripe webhook, `convertCheckoutSessionToOrder`) calls `revalidateProductAvailability` / `revalidateOrderProductAvailability` (the product pages + `/accueil` + `/card`, never throws); Gestion receipts/reversals/adjustments are wrapped with `withStorefrontInvalidation(['catalog'])`.
- `(shop)/layout.tsx` must never read cookies/session: that would make every shop page dynamic again and disable ISR on `/products/[slug]`, `/accueil` and `/avis`. Per-customer UI (e.g. `ActiveCheckoutRecovery` → `GET /api/checkout-sessions/active`) is resolved client-side.
- Any admin route that writes tenant, catalogue, social links, review moderation or review/feature settings wraps its handlers with `withStorefrontInvalidation([...scopes], handler)` so changes appear immediately; the TTLs only bound staleness for writers that forget.
- Navigation `<Link>`s use `shopLinkPrefetch(href)` (`src/lib/storefront/linkPrefetch.ts`): default prefetch only towards ISR/static pages, `prefetch={false}` towards dynamic/personal ones (catalogue `/` and its `?query` views, cart, account, orders) — on a dynamic route every viewport prefetch is a Vercel Function invocation. `GET /api/quantity-groups` is CDN-cached (`s-maxage=60`) and read through one shared client store (`lib/cart/quantityGroupsStore.ts`); never add a globally mounted component that fetches on mount without dedupe and an `enabled` condition.
- `public/sw.js` is network-only (no `fetch` handler): it must not proxy or cache HTML, RSC payloads or Next.js chunks.

### Assisted orders (WhatsApp / phone / Instagram / in-store) — `docs/ASSISTED_ORDERS.md`

- A staff-entered purchase is a `checkout_sessions` row with `origin = 'assisted'` (`draft → open (/pay/[token]) → awaiting_verification → completed`); **no `orders` row exists before payment is confirmed**. Customer-facing recovery code must keep filtering `origin = 'storefront'`.
- Every conversion (assisted Stripe webhook `metadata.type = assisted_preorder`, manual confirmation, "Déjà payé") goes through `src/lib/orders/convertCheckoutSessionToOrder.ts` → RPC `convert_checkout_session_to_order` (migration 128): row lock + order/items/stock in one transaction, unique `orders.checkout_session_id`; side effects run only when `created = true`.
- `orders.email` can be null for assisted orders: never assume an email; tracking tokens are `HMAC(orderId + (email ?? ''))`.

### Unpaid card carts (Stripe) — admin sheet, Stripe lookup, comeback link (no migration)

- `/admin/paiements-en-attente/[id]` serves both `external_link` and `stripe` storefront sessions; « Paniers à relancer » (checkout funnel) links there and labels card carts with `CARD_CART_STATUS_META`.
- What happened = `classifyCardCart(events)` in `src/lib/payments/cardCartOutcome.ts` (pure, tested) over the session's `payment_funnel_logs`: the browser events (now carrying the session id via `referenceIdRef`, `confirm_attempted` logged after `createIntent`) plus `payment_failed_server`, written by the Stripe webhook through `recordCardPaymentFailure` (idempotent per Stripe event, codes only, fail-open).
- Live Stripe status: `GET /api/admin/checkout-sessions/[id]/stripe` (`orders.view`) — read-only `paymentIntents.retrieve` (shop key, fallback test key), `describeStripeIntent` → status, reason, brand + last4. Never any action on the payment.
- Reminder (`POST .../reminder`): `cartRecoveryMode` (`src/lib/checkout/cartComeback.ts`) — open session → `/checkout/reprendre/...`; expired card cart within 14 days → signed `/panier/retrouver/[id]?token=` (HMAC `cart-comeback:` + TRACKING_SECRET), email `cartComebackEmail` (never the decline reason). The page rebuilds the cart at today's prices/stock (`rebuildCartLines`), then the normal checkout re-validates everything. No email → « Copier le lien » only.

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

### External WhatsApp catalog import (CLI + platform console) — `docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md`

- `pnpm catalog:whatsapp:test --url https://wa.me/c/<n> [--limit] [--dry-run] [--no-images]` reads a third-party catalog via GREEN-API (`GREEN_API_URL/INSTANCE_ID/TOKEN`), writes only to git-ignored `artifacts/whatsapp-catalog/`; `pnpm catalog:whatsapp:review` serves the review page on 127.0.0.1. No Supabase, no tenant storage, no messages sent.
- Platform console `/admin/platform/catalogues-whatsapp` (platform owner only, migration 149, flag `external_catalog_import` on the TARGET tenant): sources (seller → tenant, seller phone required, consent), refresh via GREEN-API, per-item field-by-field apply through RPC `external_catalog_apply_item` (idempotent `requestKey`, audited, created products inactive/stock 0). WhatsApp price = total for the minimum quantity → unit price via `lib/externalCatalog/pricing.ts` `computeUnitPrice` (lot ÷ min × (1 − discount %), integer cents). Writes go to another tenant's products, so cache invalidation only reaches the current deployment (TTL elsewhere).
- Provider-independent code in `src/lib/externalCatalog/` (no `@/` aliases: also run by Node type stripping via `scripts/ts-resolve-hooks.mjs`). Deterministic FR/IT/EN quantity parser; `package_count` ≠ `suggested_min_quantity`; nothing is confirmed without a review decision, and confirmed values map to `min_order_quantity`/`order_quantity_step` only through `toLepefyQuantityRule` (uses `computeQuantityRuleState`).

### Journal d'activité (audit) — `docs/ADMIN_ACTIVITY_AUDIT.md`

- One append-only register `audit_events` (migration 153), typed catalogue `audit_event_types` (FK) mirrored by `lib/audit/eventCatalog.ts` (parity test). Only `record_audit_event` writes; `service_role` can only SELECT; UPDATE/DELETE are rejected even for the owner.
- Business tables are audited by triggers in the same transaction (orders, products, customers, tenants, flags, module settings, payment methods, RBAC). Orders/payments/catalog/shipping/customers are fail-open (`audit_write_failures`), RBAC/tenant/flags/payment methods fail-closed. New fields are not recorded unless added to the trigger allow-list — never put secrets or personal values there.
- The actor reaches the triggers as `x-lepefy-audit-*` headers sent by `createServiceClient()` on writes only (`lib/audit/requestContext.ts`: actor registered by `requirePermission()` under the middleware's `x-request-id`). A write RPC called by admins must be listed in `AUDITED_WRITE_RPCS`; workers pass `createServiceClient({ auditActor })`. Never derive or invent an actor.
- Reads go through `audit_feed` (new events + read adapters of the existing audit tables, no copies) and `lib/audit/feed.ts`, scoped by `lib/audit/scope.ts` (source-module permission). `/admin/activite` and `/api/admin/activite/**` are platform-owner only until the platform-only flag `activity_journal` is enabled for the tenant.

### Internal notification recipients — `docs/NOTIFICATION_SUBSCRIPTIONS.md`

- Notification types are a code catalogue (`src/lib/notifications/notificationTypes.ts`: `NOTIFICATION_TYPES`, groups, presets); the DB stores only `tenant_notification_subscriptions (tenant_id, recipient_id, type_key, channel)` (migration 143). Adding a type = one registry entry, never a new `notify_*` column (those are legacy, backfilled by 143).
- Senders call `getNotificationRecipients(db, tenantId, '<type_key>')` (or `sendTenantEmail({ recipientFlag })`) → RPC `notification_recipient_emails`, which also drops recipients linked (`admin_user_id`) to an inactive admin/membership.
- All subscription edits go through `POST /api/admin/notification-recipients/subscriptions` (batch of `{ recipientId, typeKey, subscribed }`); types of disabled modules (`events_enabled`) are hidden in the UI but their subscriptions are preserved.

- Staff WhatsApp and the dispatcher (migration 158): new internal alerts go through `dispatchTenantNotification` (`lib/notifications/staff/dispatcher.ts`) with a `StaffAlert` (`staffMessages.ts`): one immutable event per transition, one `notification_deliveries` row per recipient × channel (`notif:<event>:<recipient>:<channel>`), never throws. Existing email senders keep their email; the dispatcher adds WhatsApp only (`channels: ['whatsapp']`). WhatsApp goes to confirmed recipient numbers only (`whatsapp_verified_at`), behind flag `staff_whatsapp_notifications`, via Green API (`providers/greenApiOutbound.ts`, never the read-only catalog connector); `unknown` deliveries are never retried automatically. The platform-owner catch-up `/admin/platform/notifications/rattrapage` is preview → explicit confirmation only. Runbook: `docs/STAFF_NOTIFICATIONS_RUNBOOK.md`.

### Brevo Email Analytics (platform owner) — `docs/BREVO_EMAIL_ANALYTICS.md`

- `POST /api/webhooks/brevo` (Bearer `BREVO_WEBHOOK_TOKEN`, fail closed) appends to `brevo_email_events` (migration 170): dedupe key, recipient as HMAC key + (migration 172) readable address for the platform owner, no subject, clicked link = origin+path with token segments redacted (never query/fragment). Tenant/type/subject/entity are NOT stored: the view `brevo_email_message_summary` joins the ledger (`notification_deliveries.provider_message_id`) at read time, so late or out-of-order events attribute correctly. A message is (message-id, recipient): Brevo reuses one id for every recipient.
- Page `/admin/platform/notifications/email-analytics` (platform layout guard); pure KPI rules in `lib/notifications/brevoAnalytics.ts`, parsing/categories in `brevoEvents.ts` (category by `notification_type`/tag, never by subject; the Brevo account is shared with other Lepefy projects, so only ledger-linked or our-tag messages count). Missing data is « n.d. », never 0; every rate shows its denominator. Retention 180 days via an opportunistic purge in the webhook (no cron).

### Assistance & suggestions (shop ↔ Lepefy) — `docs/SMART_ASSISTANCE.md`

- Release flag `support_assistance` (platform-only) + capability `support.use` (migration 163). Shop APIs `/api/admin/assistance/**` call `supportTenantApi()` (tenant from `getTenant()`, never the browser; writes refuse the platform owner); console APIs `/api/admin/platform/assistance/**` call `supportPlatformApi()` (`requirePlatformOwner`), absent from `adminApiPermissions.ts`.
- Tables `support_*` are RLS-forced with no policy and read-only for the service role: every write goes through a `support_*` RPC (idempotent `client_key`, anti-abuse limits, state machine mirrored in `lib/support/rules.ts`, parity-tested). Shop reads only through the projection RPCs (`support_tenant_thread`, `support_tenant_ticket_page`, …): internal notes, internal files, private events, priority, assignee and GitHub links never reach a shop — never add a direct `support_*` select to shop code.
- One quick panel for every admin page (`SupportProvider` in the protected layout → `useSupport().open()`); a message relayed from WhatsApp/phone is stored as `relayed_from` by Lepefy, never as written by the shop. Screenshots: private bucket `support-attachments`, type from bytes, read through the authorized route (60 s signed URL). Notifications: type `support_reply` via the dispatcher; Lepefy e-mail only through `SUPPORT_NOTIFY_EMAILS`.

### Demo Experience (prospect demos) — `docs/DEMO_EXPERIENCE.md`

- Same code, separate Supabase project and Vercel project (`lepefy-demo`). Two keys: server env `LEPEFY_DEPLOYMENT_KIND=demo` + private column `tenants.is_demo` (always with `is_test`, migration 167). Blocking a real side effect needs one key (`isDemoDeployment()`); opening demo features (`/demo`, visitor accounts, console) needs both (`isDemoActive()`, `lib/demo/demoEnvironment.ts`). The 167 RPCs raise `demo_disabled` without an active demo tenant: inert in production.
- On a demo deployment nothing real leaves: `getStripeSecretKey` refuses non-test keys and the webhook refuses `livemode` events; `sendNotification`/`sendViaBrevo` record `demo_simulated_messages` instead of sending; Meta, Green API, WhatsApp n8n dispatch and Packlink (`resolvePacklinkApiKey` → null) are blocked. A new outbound provider must add the same guard.
- Visitors get an ephemeral `demo_visitor` account (read-only `*.view`, 4 h, `POST /api/demo/visit`); `getAdminAccessContext` refuses an expired visit and `tests/unit/demoExperience.spec.ts` fails if an admin write API becomes reachable with a visitor capability. The root layout renders `DemoRibbon`/`DemoTour` (and the private-demo gate, which reads a cookie) only when the demo is active — never on a production deployment.
- Data: `scripts/demo/seed-demo.mjs` (scenarios in `scripts/demo/scenarios`, deterministic plan, idempotent, refuses any DB whose URL is not `DEMO_SUPABASE_PROJECT_REF`). Reset = tenant rotation (append-only tables forbid DELETE), refused during a presentation lease. Schema of the demo DB: `scripts/demo/build-demo-schema.mjs` / workflow `demo-database`; apply each new migration there too.

### Auth Mailer (Auth emails per tenant) — `docs/AUTH_MAILER_MULTITENANT.md`

- Supabase Send Email Hook → Edge Function `auth-mailer` → Resend; Supabase keeps OTP/sessions. Tenant ONLY from the signed `lctx` context in `redirect_to` (`lib/authMailer/core/contextToken.ts`), never from the email/user_metadata; invalid context = fail closed. Edit the core in `src/lib/authMailer/core`, then run `node apps/storefront/scripts/syncAuthMailer.mjs` (a unit test fails when `supabase/functions/_shared/authMailer` is stale). Sender address is fixed to `@auth.lepefy.com`. The hook is activated manually in Supabase (cutover needs explicit approval); `AUTH_MAILER_CONTEXT_ENABLED` keeps the storefront inert until then. Never log codes, tokens or links.

### Help Center (contextual admin guides) — `docs/HELP_CENTER.md`

- Autonomous module `lib/helpCenter/`: entitlements `help_center` (standard, included in Base once the plan row is granted) / `help_center_advanced` (reserved, inactive), resolved only by `rules.resolveHelpLevel` (suspension > flag `help_center_disabled` > advanced > standard); capability `help.view`; never Assistance-dependent (no import from `lib/support`). Tenant reads go through the `help_tenant_*` projection RPCs (published revisions only); console and its APIs are platform-owner only (`helpPlatformApi`). Content is structured blocks (`blocks.ts`), never HTML.
- Migration 174 grants nothing: adding the `help_center` row to `platform_plan_features` (activation for a tenant/plan) needs the requester's explicit approval. `HelpHint` (micro-help « ? ») opens a guide from a complex field; translations live in `library/translations.ts` with the French UI labels kept identical. When an admin workflow changes, check the guides' `watch` paths in `library/initialLibrary.ts` and flag or update them; never republish without editorial control.

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

Hydration: while React hydrates, zustand `persist` serves the empty initial state, but selectors calling store methods (`s.totalItems()` reads `get()`) see the live persisted cart → mismatch, the whole root switches to client rendering. Render-time cart reads in server-rendered components go through `src/lib/cart/useHydratedCart.ts` (`useHydratedCartSelector/Items/Count`, server value until hydrated; `useHasMounted` is `useSyncExternalStore`-based). Effects acting on an empty cart (e.g. the `/checkout` → `/cart` guard) wait for hydration and re-read `useCartStore.getState()`.

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

### PWA smart refresh — `docs/PWA_LIFECYCLE.md`

- One controller (`lib/pwa/lifecycle.ts`, pure, injected deps) mounted by `components/pwa/PwaLifecycle.tsx` in the root layout (replaces `PWARegister`): on return to foreground it updates the service worker, compares `NEXT_PUBLIC_APP_VERSION` (build SHA) with `GET /api/app-version` (no DB, throttled 5 min, failures silent), refreshes server data with `router.refresh()` after ≥ 30 min away and revalidates the customer session after ≥ 6 h. No polling.
- A full reload happens only when safe: work that a reload would destroy holds a lock (`useBusyLock(active, reason)` / `acquireBusy` in `lib/pwa/busyRegistry.ts`; `useUnsavedChangesGuard`, `CheckoutFlow` and the Stripe steps already do), `activityTracker` covers touched form fields and in-flight writes, critical routes and unsynced cart mutations also block, and `sessionStorage` `lepefy:pwa-reload` allows one automatic reload per target per 30 min. Otherwise a banner offers the update. New payment/editing UI must take a lock; never reload from elsewhere.

### Lepefy Admin PWA (installable admin) — `docs/ADMIN_PWA.md`

- Manifest `/admin/manifest.webmanifest` (id/scope `/admin`), metadata override in `app/admin/layout.tsx`; the storefront manifest is the route `app/manifest.webmanifest/route.ts` (a `manifest.ts` file convention would beat the admin override). `public/sw.js` stays network-only.
- Workspace = path (`/admin/evenementiel/**` events), legacy events host still maps to events; optional canonical host `ADMIN_HOST` (+ `ADMIN_FALLBACK_HOST` 307, `ADMIN_LEGACY_REDIRECT=1`), all inert when unset. Cookie `lepefy_admin_ws` is UX only. Meal scanner: `/admin/evenementiel/scan` (`/scan` redirects).

### Admin

`/admin` routes are protected via **Supabase Auth** (email/password) implemented at the Server Component layout level (Edge middleware is not used due to Vercel monorepo limitations).

**Route structure** (`src/app/admin/`):
- `layout.tsx` — HTML shell only (CSS vars from tenant, no auth check); wraps all admin routes including login
- `(protected)/layout.tsx` — auth check via `createServerClient` + `cookies()`; looks up the caller in `admin_users` (`id`, `role`, `tenant_id`, `active`); wraps dashboard, orders, and every other route in the group. Resolves the navigation on the server (`resolveAdminNavigation` in `src/lib/admin/navigation.ts`, the single registry behind sidebar, mobile drawer, bottom bar and command palette) from the same permissions and feature flags, and renders `AdminShell` + `AdminHeader` (`app/admin/_components/shell/`); platform-only entries (`platformNavConfig.ts`) only render for `platform_owner`. Hiding an entry is UX only — the route check above and `requirePermission` stay the security control.
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
STRIPE_WEBHOOK_SECRET_PLATFORM=      # signing secret(s) of Lepefy's own Stripe account (SaaS Payment Link); only these renew a subscription, never a tenant's secret
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

# Scheduled promotions and novelties (migration 156)
CATALOG_SCHEDULE_SCHEDULER_TOKEN=    # bearer of the n8n tick POST /api/internal/catalog-schedule

# Demo Experience (demo deployment only, docs/DEMO_EXPERIENCE.md §9)
LEPEFY_DEPLOYMENT_KIND=              # "demo" on the demo Vercel project only; never set in production
DEMO_ACCESS_MODE=                    # public | private (private = signed access link)
DEMO_ACCESS_SECRET=                  # HMAC of private access links, ≥ 32 chars
DEMO_INTERNAL_TOKEN=                 # bearer of POST /api/internal/demo/revalidate (seed after a reset)

# Assistance (migration 163, optional)
SUPPORT_NOTIFY_EMAILS=               # Lepefy addresses notified of new requests / shop messages, comma-separated

# Engineering Hub (docs/engineering/RUNBOOK.md)
ENGINEERING_INGEST_TOKEN=            # bearer of POST /api/internal/engineering/ingest (>= 32 chars; also a GitHub Actions secret). Unset = ingest disabled
```

## Conventions

- **Locale**: All UI strings are in **French** (`fr-FR`), currency EUR
- **Icons**: Use `@tabler/icons-react` exclusively
- **Forms**: React Hook Form + Zod validation
- **Routing**: Next.js App Router; customer-facing pages live under `src/app/(shop)/`, API routes under `src/app/api/`
- **Types**: Shared domain types live in `packages/types/`; import as `@lepefy/types`
- The `packages/types/shipping.ts` `ShippingZone`/`ShippingRate` types are legacy and not used — the active shipping config is in the DB tables `packaging_surcharges` and `shipping_vat_rates`
