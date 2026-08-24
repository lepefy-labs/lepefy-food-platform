# Checkout Recovery v2 — rollout

This release changes `checkout_sessions` from disposable payment staging rows into the durable purchase-intent lifecycle used for checkout recovery and conversion analytics.

## Required deployment order

1. Apply `supabase/migrations/074_checkout_recovery_lifecycle.sql` to the production Supabase database.
2. Verify the migration succeeds and that `checkout_sessions` exposes `expires_at`, `last_activity_at`, `completed_at`, `order_id`, `resume_count`, and `last_resumed_at`.
3. Merge/promote the application commit from `ux-agent/checkout-recovery-v2` to `main`.
4. Verify the production Vercel deployment reaches `READY`.
5. Smoke-test:
   - new Stripe checkout;
   - retry the same authenticated checkout and confirm the same checkout session is reused;
   - `/checkout/reprendre/[id]`;
   - switch Stripe -> external link;
   - cancel recovery;
   - successful Stripe order creates `orders` and keeps the checkout row as `completed` with `order_id`;
   - external-link admin confirmation keeps the checkout row as `completed`;
   - `/orders` shows at most one “Achat à finaliser” separately from order history;
   - `/admin/checkout-funnel` loads real 30-day metrics.

## Important invariants

- No `orders` row is created for an incomplete online payment.
- Stock is not reserved by an open checkout session.
- Prices, stock, shipping quote and discounts remain server-validated.
- Guest checkout recovery continues to use signed access tokens; email is not used as an identity key.
- Completed checkout sessions are retained for audit/analytics and linked to their final `order_id`.
- Abandoned-checkout email/push campaigns are intentionally not enabled by this release; consent, timing and channel policy must be approved separately.
