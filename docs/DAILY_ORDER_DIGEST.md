# Rapport opérationnel quotidien (08:00)

## État / activation
Migration `129_tenant_daily_digest.sql` is additive and **disabled by default**. It is **applied in production** (26 Sept 2026; verified: `daily_order_digest` registered as non-billable, no settings rows, no runs, no opted-in recipients, Nala row intact). As of 26 Sept 2026 evening, ChloeFood is **enabled** from Paramètres (valid config, `include_empty = true`) with one opted-in recipient; no run recorded yet. Emails are actually sent only once the secret, the scheduler and the n8n webhook are also in place — these are outside the repository: check `tenant_daily_digest_runs` after 08:00.

1. ~~Apply migration 129~~ — done (26 Sept 2026). In an environment without it the code fails safe: the internal endpoint answers 503 and Paramètres shows "migration 129 requise".
2. Set `DAILY_DIGEST_CRON_SECRET` in the storefront production environment (server-side only).
3. In n8n (Hetzner), import `ops/n8n/daily-order-digest-dispatcher.json` and attach an HTTP Header Auth credential (`Authorization: Bearer <secret>`). The inactive template has a Schedule Trigger every hour at minute 0. POST `https://<tenant-storefront>/api/internal/daily-order-digest` with `Authorization: Bearer <secret>`. The server checks the tenant's IANA timezone and sends only if it is currently 08:00 locally (DST safe).
4. Create the n8n POST webhook `/webhook/daily-order-digest`. It receives `subject`, the already rendered and escaped `html`, `recipients[]`, `idempotencyKey` (`tenantId:localDate`), `snapshot` and branding. Configure a transactional email node using only `recipients[]`, HTML and subject. Return 2xx **only after the email provider accepted the send**, otherwise non-2xx. Implement provider-side deduplication with `idempotencyKey`.
5. In Admin > Paramètres > Notifications, enable **Rapport quotidien (08h)** for at least one active recipient. In Admin > Paramètres > Rapport des commandes à 08h, activate the tenant only after successful integration testing. The recipient flag alone does not enable the tenant. A privileged operator can also enable ChloeFood through the validated admin API, or directly in SQL:
   ```sql
   insert into public.tenant_feature_settings (tenant_id, feature_key, enabled, config)
   select id, 'daily_order_digest', true, '{"version": 1}'::jsonb from public.tenants where slug = 'chloefood'
   on conflict (tenant_id, feature_key) do update set enabled = true, updated_at = now();
   ```
6. Inspect `tenant_daily_digest_runs` after the first delivery. `accepted` means the n8n endpoint acknowledged the send, not proof of inbox delivery.

## Data model (migration 129)
| Concern | Storage |
|---|---|
| Catalog entry | `platform_features('daily_order_digest')`: `billable = false`, category `operations`, **in no plan and without overrides**. Included operational module, not purchasable, not resolved via `hasTenantFeature()`. |
| Activation + settings | One row `tenant_feature_settings (tenant_id, 'daily_order_digest')`. `enabled` is the operational switch. **Missing row = disabled.** The migration creates no rows. |
| Settings shape | `config` JSONB `{version: 1, timezone, include_empty, prepare_hours, pickup_hours, payment_verification_hours, tracking_stale_hours}`. Missing keys take the centralized defaults. Enforced by CHECK `tenant_feature_settings_daily_digest_config_check` → `is_valid_daily_digest_config()`, scoped to this feature key only. |
| Recipients | `tenant_notification_recipients.notify_daily_digest` (opt-in, default `false`). Never stored in the JSONB. |
| Execution ledger | `tenant_daily_digest_runs (tenant_id, local_date)` plus the service-role-only RPC `claim_tenant_daily_digest`. |

- No `tenants.daily_digest_*` columns. If an environment had applied the first draft of 129 (which added them), the migration backfills customized rows into `tenant_feature_settings` with a count check, revokes public SELECT on those columns and keeps them (no drop in this phase).
- Other module rows (Nala, reviews…) are never touched; CI proves this byte-for-byte.
- Privileges: `tenant_feature_settings` and `tenant_daily_digest_runs` are service-role only (RLS on, nothing granted to anon/authenticated). The claim RPC and the config validator are executable only by `service_role`.

| Key | Default | Range |
|---|---|---|
| `timezone` | `Europe/Rome` | IANA named zone (no raw offsets) |
| `include_empty` | `false` | boolean |
| `prepare_hours` | 24 | 1–336 |
| `pickup_hours` | 48 | 1–336 |
| `payment_verification_hours` | 48 | 1–336 |
| `tracking_stale_hours` | 72 | 24–336 |

## Application layer
- `lib/tenantConfig/moduleConfig.ts`: generic, typed access to one `tenant_feature_settings` module. Provides tenant-scoped reads, pure `resolveModuleConfig` (`missing` / `ok` / `invalid`) and partial updates (read → merge → validate → upsert of this module's row only).
- `lib/notifications/dailyDigestConfig.ts`: zod schema, defaults, IANA validation, the admin PATCH schema (strict) and the mapping to classifier thresholds. It is the only place that knows the JSONB keys.
- `lib/notifications/dailyDigestRunner.ts`: `listDigestTenants()` selects enabled rows of active tenants. A row with an **invalid configuration is skipped and reported (`invalid_config`)**, never run with silent defaults. `deliverTenantDigest()` holds the per-tenant flow with injected recipients, branding and n8n dependencies.
- `POST /api/internal/daily-order-digest`: Bearer secret. Outcomes: `accepted`, `failed`, `not_due`, `no_recipients`, `already_claimed`, `empty`, `invalid_config`.
- `GET/PATCH /api/admin/daily-digest`: permissions `tenant_settings.view` / `tenant_settings.manage` (unchanged from the former route). The body is `{enabled?, config?: Partial<…>}`; unknown fields are rejected. The route answers 409 while the migration is missing. `/api/admin/tenant` no longer accepts digest fields and now echoes only its editable projection instead of the full tenant row.
- Admin Paramètres "Rapport des commandes à 08h" reads and writes through that API. A stored invalid configuration shows a blocking notice; the report stays suspended until it is corrected.

## Business behavior
- Paid orders only in the normal preparation queue. Stock conflicts, provider shipping exceptions, syncing errors and inconsistent unpaid order records are urgent. Pending unconverted purchases stay in `checkout_sessions`; a declared external payment is never a paid order.
- Preparing/new paid orders are `today` and become `urgent` after `prepare_hours` (default 24 h).
- Managed shipments with a known provider reference and no new tracking event beyond `tracking_stale_hours` (72 h) are monitored. Shipments past the provider-estimated delivery date are urgent but not automatically deemed lost.
- Ready-for-pickup orders are `monitor` and become `urgent` after `pickup_hours` (48 h) since the last `orders.updated_at`. This is an approximation, not an exact ready timestamp.
- Verified external pending payments are NOT assumed. Unresolved payment sessions are actionable after `payment_verification_hours` (48 h). Assisted drafts older than 24 h enter monitoring.
- Fulfilled/cancelled orders excluded; shipping in transit without known incident excluded. One priority per record. Up to five detailed cards per priority, then the remaining count and a link to the authenticated admin. Urgent cards carry the red "Traiter cette commande →" CTA.
- Subject, summary and HTML are French. No postal address or card data. Comparisons to the last accepted snapshot mean **no longer flagged**, not proven shipped/delivered.
- If there are no items, the email is skipped unless `include_empty = true`. If there is no opted-in recipient, the tenant is skipped before any claim.
- The database claim is unique per tenant/day and can recover failed or abandoned processing (30-min lease). If n8n accepted but the server fails before recording acceptance, a retry may duplicate: n8n/provider idempotency on the payload key is still required. Do not treat webhook HTTP 2xx as actual delivery.
- The endpoint intentionally does not send outside tenant-local hour 08, even for a delayed retry. An operator can replay a failed run during the same hour. Limit is 10,000 active rows per data family; the run fails closed above that.

## Verification
- Unit: `pnpm --filter @lepefy/storefront test:unit`. Covers:
  - classification and HTML (`daily-order-digest.spec.ts`);
  - config, defaults, invalid values and IANA/DST (`daily-digest-config.spec.ts`);
  - tenant isolation, missing recipients, claim idempotency, empty days and n8n refusal (same file).
- SQL (CI, postgres:16): `supabase/tests/129_tenant_daily_digest*.sql`.
  - Replays the real 094 → 096 → 129 (twice) on a throwaway database.
  - Asserts catalog semantics, Nala/reviews preservation, no auto-activation, scoped CHECK, grants and claim idempotency.
  - A legacy variant proves the backfill from draft columns.
- Validate on staging with one dedicated recipient and a non-production tenant; observe the response and the run ledger. Do not send real customer messages in this workflow. Avoid putting raw email content in external log aggregation.

## n8n import bundle (two separate workflows)

Files in `ops/n8n/`:
- `daily-order-digest-dispatcher.json`: existing hourly schedule, inactive by default.
- `daily-order-digest-email-receiver.json`: inbound POST `/webhook/daily-order-digest`, authenticated with Header Auth, input validation, atomic PostgreSQL claim, SMTP send, accepted/duplicate/busy response.
- `daily-order-digest-idempotency.sql`: schema for a dedicated n8n-accessible PostgreSQL database. Do not run it on production Supabase without separate approval.

Configure Vercel production `DAILY_DIGEST_CRON_SECRET` for the dispatcher and a **different** `N8N_DAILY_DIGEST_WEBHOOK_SECRET` for the receiver. The outbound helper sends `X-Lepefy-Webhook-Secret` only for the daily digest, and fails closed if that variable is absent. In n8n, attach the matching Header Auth credential to the receiver Webhook. Set `N8N_WEBHOOK_URL` to the n8n root URL (or to its `/webhook` prefix, both are normalized). The SMTP, Postgres and Header Auth credentials never belong in exported JSON.

Import both workflows, create the Postgres table, attach their credentials and replace the placeholder verified sender. Leave both workflows inactive until a synthetic-payload test verifies 200 after SMTP acceptance, duplicate returns 200 without resending, and in-progress retries return 503. Only then activate the receiver and dispatcher. The tenant's current database/opt-in state must be verified before the first live run.

The SQL claim prevents concurrent sends and standard retries. SMTP cannot guarantee exactly-once across the crash window after the provider accepted email but before the PostgreSQL row was marked accepted; for stronger guarantees use a provider with durable request idempotency. Existing `tenant_daily_digest_runs` continues protecting tenant/day on the application side.
