# Promotions & Nouveautés — operational design

Reviewed against `main` at `2e496633e1ba5cf0a64ce8afa6e44b40ac7c72b9` (14 October 2026).

## State and dependency

The operator reports that migration `157_catalog_campaigns.sql` was applied to production on 14 October 2026. This has not been independently verified from this workspace. It depends on the audit foundation (153) and product promotion scheduler (156). The existing `ops/n8n/catalog-schedule.json` workflow remains the only timer; it calls `/api/internal/catalog-schedule`, which invokes the extended `apply_product_promotion_schedule`. A deploy containing this code requires 153, 156 and 157 to be present first. Verify the workflow is active in each deployment separately; the file in Git is only a template.

## Source of truth

`catalog_campaigns` stores the campaign, status, schedule, discount and optimistic `version`. `catalog_campaign_products` stores membership, per-product price override and the applied regular/promotional price snapshot. `products.price` remains the paid amount. A running campaign may own a product price through `products.promo_campaign_id`; at most one campaign owns the price at a time. Novelty membership is independent, and `products.new_until` is the latest active campaign end or `manual_new_until`. The latter preserves an editor-set novelty when a campaign ends.

All campaign tables use tenant-scoped composite foreign keys, RLS and service-role-only grants. The API resolves the tenant from the authenticated deployment and checks `catalog.manage` for mutations. No browser-supplied tenant ID is accepted. Read access uses `catalog.view`.

Publication and lifecycle transitions run in the database RPC `catalog_campaign_action`: row locks, expected version and a request UUID are required. A repeated request UUID returns the same result. The preview and writer share `catalog_campaign_price`; publication repeats checks under locks. Manual promotions and overlapping scheduled/running promotional campaigns block publication. A campaign novelty may overlap a promotion. Inactive products remain in the campaign but are invisible in the public catalogue. For an until-sold-out promotion, stock below the purchase minimum blocks publication. Stock falling below that minimum ends the affected price atomically; replenishment does not restart it. End and suspension restore a price only if the product still has the exact campaign-owned values. Otherwise the membership is marked `conflict` and the newer product value is preserved.

The scheduler tracks `last_tick_at` per campaign. A failed campaign transition rolls back all product writes in that campaign, records `last_error` and retries on a later tick. A successful transition updates `last_tick_at`, so the same boundary is not replayed. The internal endpoint returns affected product IDs to the existing storefront invalidation path. Other tenant deployments still rely on their usual cache TTL. Price changes never rewrite existing orders or payments; checkout continues to read canonical `products.price`.

## Admin surfaces and API

- `/admin/catalogue/campagnes`: tenant list, filters, server pagination, statuses and actions.
- `/admin/catalogue/campagnes/nouvelle` and `/[id]`: four-step editor, paginated product search, selected products, configuration and server preview.
- Catalogue bulk action: selected visible-page products can be added to an editable campaign or prefilled into a new one. Inside the campaign editor, “all filtered results” selects the full server-side result set.
- `/api/admin/catalogue/campagnes`: list and create; `/[id]`: detail and draft/suspended config; `/[id]/search`: paginated catalogue; `/[id]/products`: aggregate add/remove/override; `/[id]/preview`: read-only server calculation; `/[id]/action`: publish, suspend, resume, end and duplicate.
- Direct product price changes for a scheduled or running promotional campaign are rejected with a campaign link. Other product fields remain editable. A product detail banner links to the associated campaigns.

## Production migration and verification checklist

1. Confirm current production schema contains migrations 153 and 156 and verify the existing catalog scheduler workflow and server token without changing them. Snapshot schema and database, record product count, and verify no active or pending campaign rows (157 is new). Review 157 against the production schema.
2. In an isolated clone, apply 157 after 156 and run `supabase/tests/157_catalog_campaigns.test.sql` plus the existing 156 suite. Check RLS/grants, trigger order, audit entries, effective prices, minimum stock, retry behavior and checkout with a synthetic tenant. No real tenant products or campaigns are used as fixtures.
3. With explicit production migration approval, apply 157 in one transaction during a controlled window. Confirm the migration appears in `supabase_migrations.schema_migrations`, new tables/functions/grants exist, existing product prices and `new_until` values match their pre-migration snapshot, and the scheduler no-op tick succeeds. Deploy code only after that check. No real campaigns are activated as part of rollout.
4. Verify the matching GitHub SHA and Vercel deployment become `READY`, then test admin reads and a draft in an isolated tenant. Confirm the existing n8n workflow is active and subsequent tick logs have no `last_error`.

**Principal risk:** 157 replaces the promotion scheduler function and the stock trigger function while adding a novelty backfill. A schema mismatch or trigger bug could affect paid prices or product availability. Verify the operator-applied migration against the checks above when production database access is available.

Preflight read-only SQL:

```sql
select version from supabase_migrations.schema_migrations
where version like '153%' or version like '156%' or version like '157%'
order by version;
select to_regprocedure('public.apply_product_promotion_schedule(timestamp with time zone)') as scheduler,
       to_regprocedure('public.end_sold_out_promotion()') as sold_out_trigger;
select count(*) as existing_products,
       count(*) filter (where promo_applied) as active_promotions,
       count(*) filter (where new_until is not null) as novelties
from public.products;
```

After applying 157, check `to_regclass('public.catalog_campaigns')`, `to_regclass('public.catalog_campaign_products')`, the new service-role grants, zero campaign rows, the original product counts and price snapshot, and a no-op scheduler tick in the clone. Do not execute a production tick merely as a health check if existing 156 schedules may be due.

**Rollback:** before any campaign row exists, roll back the code deployment, then run `supabase/rollback/157_catalog_campaigns_pre_activation.psql` with `psql -v ON_ERROR_STOP=1 -f ...`. It refuses to run if campaign rows or price owners exist, restores the exact 156 scheduler/stock functions inside the transaction, removes the 157 objects and retains audit event type keys. Reconcile the migration tracking entry separately under the database operator's normal procedure. Once campaigns have run, a blind down-migration is unsafe: suspend/end campaigns and verify `products.price`, `compare_at_price`, `promo_campaign_id` and `new_until` against the snapshot; retain audit/history exports; then perform a reviewed data repair and schema rollback. Never automatically restore a product price from an old campaign snapshot if another operation has changed it.

## Validation

`supabase/tests/157_catalog_campaigns.test.sql` covers discount formulas, rounding, tenant access, selection/search parity, publication, double submit, suspend/resume/end, stock minimum, manual and campaign conflicts, distinct mixed calendars, delayed and failed ticks, and scheduler idempotency. It passed locally on an isolated PGlite fixture with the 157 migration and a simulated 156 stock trigger. CI runs the SQL test after the real 153–157 migration chain against PostgreSQL; its result must be reviewed for this release. `apps/storefront/tests/unit/catalogCampaigns.spec.ts` covers API configuration validation, permissions and lifecycle actions. Run the unit suite, typecheck and Admin Design System guard in a complete dependency installation.
