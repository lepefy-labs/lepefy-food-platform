# Rapport opérationnel quotidien (08:00)

## État / activation
Migration `129_tenant_daily_digest.sql` additive, **disabled by default**. Until migration is applied, n8n webhook is configured, secret provisioned and one tenant enabled, NO email will be sent.

1. Apply migration 129 manually before deploying the code dependent on it.
2. Set `DAILY_DIGEST_CRON_SECRET` in the storefront production environment (server-side only).
3. In n8n (Hetzner), import `ops/n8n/daily-order-digest-dispatcher.json` and attach an HTTP Header Auth credential (`Authorization: Bearer <secret>`). The inactive template has a Schedule Trigger every hour at minute 0. POST `https://<tenant-storefront>/api/internal/daily-order-digest` with `Authorization: Bearer <secret>`. The server checks local tenant IANA timezone and sends only if it is currently 08:00 (DST safe).
4. Create n8n POST webhook `/webhook/daily-order-digest`. It receives `subject`, already rendered escaped `html`, `recipients[]`, `idempotencyKey` (`tenantId:localDate`), `snapshot`, and branding. Configure a transactional email node using only `recipients[]`, HTML and subject. Return 2xx **only after email provider accepted the send**, otherwise non-2xx. Implement provider-side deduplication with idempotencyKey.
5. In Admin > Paramètres > Notifications, enable **Rapport quotidien (08h)** for at least one active recipient. In Admin > Paramètres > Rapport des commandes à 08h, activate the tenant only after successful integration testing. Alternatively, a privileged operator can enable ChloeFood with: `update public.tenants set daily_digest_enabled=true where slug='chloefood';`. The recipient flag alone does not enable the tenant.
6. Inspect `tenant_daily_digest_runs` after first delivery. `accepted` means the n8n endpoint acknowledged sending, not proof of inbox delivery.

## Business behavior
- Paid orders only in the normal preparation queue. Stock conflicts, provider shipping exceptions, syncing errors and inconsistent unpaid order records are urgent. Pending unconverted purchases stay in `checkout_sessions`; a declared external payment is never a paid order.
- Preparing/new paid orders are `today`, become `urgent` after default 24 h. Ready-for-pickup orders are `monitor`, become `urgent` after 48 h of last `orders.updated_at` (an approximation, not an exact ready timestamp). Verified external pending payments are NOT assumed; unresolved payment sessions are actionable after default 48 h. Assisted drafts older than 24 h enter monitoring.
- Fulfilled/cancelled orders excluded; shipping in transit without known incident excluded. One priority per record. Up to five detailed cards per priority; remaining count and link to authenticated admin.
- Subject, summary and HTML are French. No postal address or card data. Count comparisons to last accepted snapshot mean **no longer flagged**, not proven shipped/delivered.
- If no items, skip email unless `tenants.daily_digest_include_empty = true`. If no opted-in recipient, skip. Tenant config defaults off.
- The database claim is unique per tenant/day and can recover failed or abandoned processing (30-min lease). If n8n accepted but server fails before recording acceptance, a retry may duplicate: require additional n8n/provider idempotency by payload key. Do not treat webhook HTTP 2xx as actual delivery.
- Endpoint intentionally does not send outside tenant-local hour 08, even for a delayed retry. An operator can replay a failed run during the same hour. Limit is 10,000 active rows per data family; fail closed above that.
- Columns `daily_digest_timezone`, `daily_digest_prepare_hours`, `daily_digest_pickup_hours`, `daily_digest_payment_hours`, `daily_digest_include_empty`, `daily_digest_enabled` are tenant-scoped. Thresholds, timezone, empty-report behavior and tenant activation are editable in Admin > Paramètres; changes are validated server-side through the existing tenant settings route.

## Operational verification
Run unit tests with `pnpm --filter @lepefy/storefront test:unit`. Validate on staging with one dedicated recipient and non-production tenant, observe response and run ledger. Do not send real customer messages in this workflow. Avoid putting raw email content in external log aggregation.
