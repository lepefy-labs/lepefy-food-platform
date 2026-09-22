# Purchase Quantity Rules — operational and maintenance contract

Reviewed against `main@2e7b721b8164e0998e5c2a97e3285debde504d05` (2026-09-22). This document describes the hardening delivery; production Supabase rollout must be checked separately.

## Business invariants

A SKU with minimum `m`, step `s` and stock `k` can be sold in positive quantities `q` only when:

```text
q >= m && (q - m) % s === 0 && q <= k
```

Defaults are `m=1,s=1`. The maximum possible amount is `0` if `stock < minimum`, otherwise `minimum + floor((stock-minimum)/step)*step`. Thus minimum 4, step 4, stock 10 permits 4 or 8, not 10. Never clamp a valid amount directly to raw stock. If stock drops or tenant rules change while a cart is open, leave the affected purchase visibly unresolved until a customer adjusts it. Do not silently persist a changed saved quantity during an ordinary GET.

An *active* combinable group with minimum `gm`, step `gs` applies to the sum of its members **only when at least one member is in the cart**. Members can be freely mixed but SKU-level rules also apply independently. Membership is explicit, **not inferred from merchandising categories**. Each product should belong to at most one active group.

## Authoritative enforcement

`apps/storefront/src/lib/purchaseQuantityRules.ts` contains the pure rules engine; `apps/storefront/src/lib/checkout/validateCheckoutItems.ts` is the only server-side loading/enforcement entry point and must be called in **every route that creates or changes payment state**:

- `/api/checkout`
- `/api/checkout/external-link`
- `/api/checkout-sessions/[id]` PATCH, including unchanged items on resume
- `/api/checkout-sessions/[id]/create-intent`

The server reads products as active and tenant-scoped, loads tenant active groups, sums duplicate item lines, checks SKU/group rules and stock and returns authoritative product names and prices. A failure to read group metadata fails closed. The PaymentIntent must not be created, updated or reused as a valid client payment step before this check. The historic session price snapshot is retained when its existing items are unchanged; when the customer deliberately edits line items, the session items come from current canonical DB products.

Cancellation is permitted even for carts that no longer satisfy rules. The recovery GET provides current minimum, step, stock and active status while retaining the saved cart so the customer can see and fix an affected line. Do not trust session or client-supplied metadata for the payment gate.

## UX and API consumers

`GET /api/quantity-groups` returns active tenant groups with explicit member IDs and no-store headers. `useQuantityGroups` returns `groups/loading/error/reload`; cart and checkout gate must remain blocked during loading and on error, while letting customers review their cart. The group progress component shows touched groups only and links to `/?quantityGroup=<id>`. The catalog filter resolves group ID from the current active group in the DB, never from query-provided product IDs. Preserve the normal catalog flow and paginate the filtered results.

The local cart store performs step-safe first-add/increment/decrement; a no-op when stock prevents reaching the next valid amount must not be advertised as a successful addition. Product card, quick add, product detail, recommendations, checkout recovery editor and quantity controls must use the same validity principle. A stock value greater than zero but below the minimum is *not purchasable*. The PDP quantity selector displays only step controls, not freeform numbers that allow invalid values.

Nala’s product actions and Cart Builder keep using per-SKU minimum+step, additionally surface active group minimum/step/progress and link to the member-filtered catalog. Nala must not automatically add unrelated items just to reach a group target.

## Admin and integrity

Both product and group APIs require positive integer minimum and step. The product editor warns when available stock cannot reach the minimum or lies between steps. Group activation checks all members against other active groups and returns `409 QUANTITY_GROUP_MEMBERSHIP_CONFLICT` with named conflicts on failure. Existing membership creation checks remain in effect.

**Known limitation:** group activation and membership checks are application-side. Concurrent admin requests may theoretically race because database migration 121 does not enforce cross-row single-active-group membership transactionally. A SQL transaction/trigger approach would require a separately approved production migration. Group membership has no independent tenant ID; only validated tenant-scoped admin routes may write it. Check the production state of migrations 121 and 122 separately; committing migration files is not evidence of applying them.

## Regression checklist

- Minimum 4/step 4/stock 10: first add 4, next 8, next click stays 8; quantity 10 must never appear from stock cap.
- Minimum 4/stock 3: product cannot be added even with positive stock.
- Entering or requesting quantity 5 when min4/step4 cannot persist 5 through storefront controls.
- Legacy cart quantity 10 when min4/step4/stock10 can decrement to 8 and sees an explicit error until corrected.
- Session created with min2 and quantity2: after min becomes4, resume/create-intent fails `QUANTITY_RULE_VIOLATION`.
- Session with group formerly min6 and now min12: resume/create-intent fails until group is completed.
- Session with stock reduced below saved quantity is not payable.
- Quantity-group read error leaves cart visible but checkout blocked.
- Group A inactive contains Coca, active group B also contains Coca: activating A yields structured 409.
- Catalog group filter shows only active explicit members for the correct tenant, with working paging.
- A successful checkout standard/external/recovery path must still work with a fully valid mixed cart.
- Verify migration application, GitHub CI for the final commit, and Vercel READY for the same SHA.
