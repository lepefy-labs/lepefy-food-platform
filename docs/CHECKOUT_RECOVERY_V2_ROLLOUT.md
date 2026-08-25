# Checkout Recovery v2 — rollout

This release changes `checkout_sessions` from disposable payment staging rows into the durable purchase-intent lifecycle used for checkout recovery and conversion analytics.

## Required deployment order

1. Apply `supabase/migrations/074_checkout_recovery_lifecycle.sql` to the production Supabase database.
2. Verify the migration succeeds and that `checkout_sessions` exposes `expires_at`, `last_activity_at`, `completed_at`, `order_id`, `resume_count`, and `last_resumed_at`.
3. Apply `supabase/migrations/075_external_payment_verification.sql` so external-link payments move to `awaiting_verification` instead of expiring like abandoned checkout sessions.
4. Merge/promote the application commit to `main`.
5. Verify the production Vercel deployment reaches `READY`.
6. Smoke-test:
   - new Stripe checkout;
   - retry the same authenticated checkout and confirm the same checkout session is reused;
   - `/checkout/reprendre/[id]`;
   - switch Stripe -> external link;
   - cancel recovery;
   - successful Stripe order creates `orders` and keeps the checkout row as `completed` with `order_id`;
   - external-link admin confirmation keeps the checkout row as `completed`;
   - external-link sessions remain visible to the admin as `awaiting_verification` until explicitly confirmed or cancelled;
   - `/orders` shows at most one “Achat à finaliser” separately from order history;
   - `/admin/checkout-funnel` separates recoverable checkout sessions from external payments awaiting verification.

## Important invariants

- No `orders` row is created for an incomplete online payment.
- Stock is not reserved by an open checkout session or an external payment awaiting verification.
- Prices, stock, shipping quote and discounts remain server-validated.
- Guest checkout recovery continues to use signed access tokens; email is not used as an identity key.
- Completed checkout sessions are retained for audit/analytics and linked to their final `order_id`.
- An external-link session is never considered paid automatically: an admin must confirm receipt before the order is created.

## Roadmap — checkout recovery reminders

Email/push recovery remains intentionally deferred. The approved direction is:

- use the existing **marketing consent** as the eligibility gate, provided it remains explicit and separate from Terms & Conditions;
- do not infer marketing consent from acceptance of Terms & Conditions;
- expose checkout-recovery wording in the marketing consent so the purpose is transparent;
- store/audit at least consent state, consent timestamp and consent source;
- add per-session delivery tracking such as `recovery_email_sent_at` / `recovery_email_count` before enabling automation;
- keep reminder frequency conservative and tenant-configurable;
- never send after `completed`, `cancelled`, `expired`, or while an external payment is `awaiting_verification`;
- make the feature disabled by default until channel, timing, unsubscribe and tenant configuration are implemented and tested.

The on-site recovery surfaces and funnel telemetry are already the source of truth for this future automation.
