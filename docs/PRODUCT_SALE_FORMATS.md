# Formats de vente — contrat et runbook

Reviewed against `main@49a5bbf0323ac3b584873b812e5cb8b1dc0296a2` (2026-11-19). Migration `187_product_sale_formats.sql`. Applied to production on 2026-11-19 (Supabase SQL editor, before the code deploy); not applied to the demo database. No tenant has formats yet.

Several sellable formats under one public product page (« 1 paquet », « Lot de 3 paquets »). Generic and multi-tenant: nothing is specific to a product, and a product without formats behaves exactly as before.

## 1. Model

- **A format is a `products` row.** The canonical product (existing row, same id, slug, URL, carts, orders) is the *base format* (`units_per_sale = 1`, `format_label` e.g. « 1 paquet »). Each extra format is a child row (`format_parent_id` → base, composite FK on `(tenant_id, id)`), with its own id, price, promotion, weight (whole format, packed), status, minimum/step.
- **One level only** (trigger `products_sale_format_inherit`): a child has no children, a base has no parent, same tenant. A child inherits name (`<base name> — <label>`), storage type, fulfillment policy and category from its base (kept in sync by `products_sale_format_propagate`). `featured` is always false on a child.
- **Three numbers stay distinct**: format chosen (cart line `product_id`), quantity bought (line quantity), physical units (`quantity × units_per_sale`).
- `pack_count` (154) stays descriptive only. Never use it as a stock or price multiplier.
- Not modelled with `product_relationships` and not a separate `product_formats` table: cart, cart sync (`carts`, `apply_cart_mutations`), checkout sessions, Stripe, `convert_checkout_session_to_order`, orders and documents all stay on `product_id`.

## 2. Stock

- `format_stock_mode = 'shared'` (default): the **authoritative stock is the base row, in base units**. The child's `stock` is a mirror `floor(base.stock / units_per_sale)`, recomputed by triggers in the same transaction as any base stock change (order decrement, Gestion receipt/adjustment, editor). Writing any other value on a shared child raises `format_stock_is_derived:<id>` (editor PATCH → 409, Gestion → 409 « recevez ou ajustez le stock sur la fiche »).
- `format_stock_mode = 'own'`: separate cartons; the child keeps its own stock and is decremented on its own. Never adds to the base.
- **Decrement** (`decrement_stock_for_order`, same signature and callers: in-store checkout, Stripe webhook, RPC 128): each line is resolved to (stock row, base units), summed per stock row, one `UPDATE … WHERE stock >= need` per stock row in id order (row lock, no deadlock), all or nothing, same `insufficient_stock:<product_id>` error → existing `stock_conflict` handling. 2 lots of 3 + 1 single consume 7; on stock 7, 2 lots + 2 singles fail with nothing decremented.
- **Validation** (`validateCheckoutItems`, every payment path): same aggregation (`aggregateStockDemand` in `lib/catalog/saleFormats.ts`) against the base stock; a child whose base is inactive is `PRODUCT_UNAVAILABLE`. The client gate (`useCartPurchaseGate`) uses the same function for guidance only.
- Retries: idempotency stays where it was (one order per PaymentIntent / per checkout session); the decrement runs once per created order. No automatic restock exists on closure, unchanged.
- The sold-out promotion trigger (156/157) works on the child's derived stock.

## 3. Prices, promotions, weight, shipping

- `price` of each row is always the price paid (promotions per row, unchanged engine). Savings shown = `units × base effective price − format effective price`, only when > 0 (`formatSavings`). Never preselect a format.
- `weight_grams` of a child = weight of the whole packed format. Shipping (quote, forfait, packaging bands, Packlink draft) keeps `weight_grams × quantity` per line: no double multiplication. No tariff or payment change.

## 4. Storefront

- **One card per product**: every public listing filters `format_parent_id is null` (catalogue pages and ranking RPC `catalog_ranked_product_ids`, search, shelves, suggestions, related, novelties, promotions, petits plus, `/card`, Goodies, Nala lookups, `match_products`). Guard test: `tests/unit/saleFormats.spec.ts`.
- Card projection `PRODUCT_CARD_SELECT` embeds the active formats through the PostgREST computed relationship `sale_formats(products)` (one query, never one per card).
- Price display (card and product page): the base price as usual (« 3,50 € le paquet ») plus the offer « 3 pour 10,00 € » (`saleFormatOfferLine`, cheapest lot with positive savings only). Never a rounded or derived per-unit « à partir de » price.
- First add unchanged: card CTA « Choisir le format » → `FormatChooserDialog` (sheet on mobile, dialog on desktop, focus trap, Esc); product page `SaleFormatPicker` (native radios, no preselection, CTA « Choisissez un format » until chosen). The chosen format only sets the **starting quantity in base units** (1 or 3); on the product page « Quantité » then counts base units too (+ adds one pack, never one more lot) and the highlighted format follows the cheapest combination (3 packs → the lot, with « 3 paquets = 1 lot de 3 paquets · −0,50 € » below the picker); a single purchasable base format keeps the direct add. A sold-out format stays visible and disabled; all formats sold out = existing « Épuisé » block. A child slug redirects (308) to the base page.
- **Automatic bundling (v2)**: once in the cart, every +/− (card, product page, cart, drawer) adds or removes **one base unit** and the cart recomposes the cheapest combination: `planFormatBundle` (bounded dynamic programming, several lot sizes, each format's stock/min/step; equal cost keeps singles, so a lot that saves nothing is never imposed) → `setFormatUnits` / `useFormatUnits` → `cartStore.applyFormatPlan` (decreases first, then increases, existing mutations). 3 singles → 1 lot; 1 lot − 1 → 2 singles; 1 lot + 1 → lot + single; 6 → 2 lots. The counter shows « 4 paquets », with « dont 1 lot de 3 paquets · −0,50 € » or « Encore 1 paquet : les 3 à 10,00 € » below (`bundleCaption`).
- Cart page and drawer show the formats of one product as **one line** (`CartFormatGroupItem`, data from `useCartFormatGroups` → `GET /api/products/formats?ids=`, no-store; drawer only when open and only for lines already marked as formats). Without fresh data the real lines are shown separately, as before. The cart page recomposes a cart saved before bundling once, only when it lowers the total. Last unit removed = usual removal with 5 s undo. Cart counters (header, badge) count a lot as its units.
- The real cart lines stay lot × n and single × m: server validation, Stripe, orders and documents are unchanged. An old open browser tab may still send 4 singles (14,00 € instead of 13,50 €): correct but not optimal, fixed on next page load; server-side normalisation would touch checkout and is out of scope.
- An order of a lot revalidates the base product page (`revalidateProductAvailability`).

## 5. Orders and documents

- Trigger 162 v2 freezes on `order_items.format_snapshot`: `v: 2`, `format_label`, `units_per_sale`, `stock_product_id` (shared), plus the base unit fields (`sale_unit`, content) read from the base for a child. Immutable, fail-open, no backfill; v1 snapshots unchanged.
- `orderItemFormatLabel` → « 1 paquet · 500 g » / « 3 × 500 g »; `orderItemPhysicalUnits` → « 6 paquets » for 2 lots, shown on the picking list (« = 6 paquets à prendre ») and the admin order detail (« = 6 paquets à préparer »).
- Historical orders keep their lines, prices and snapshots; deactivating a format never touches them.

## 6. Admin

- Product editor section « Formats de vente » (`ProductSaleFormatsSection.tsx`): base label, formats (name, units per sale, price, weight, on sale, stock shared / separate cartons, order), live warnings (base minimum > 1, active quantity groups — never disabled implicitly —, missing/low weight, no savings, stock insufficient), « Aperçu client ».
- API `GET/PUT /api/admin/catalogue/[id]/formats` (`catalog.view` / `catalog.manage`, `withStorefrontInvalidation(['catalog'])`) → RPC `set_product_sale_formats` (service role only, full list, atomic, parent locked, max 8; a removed format is set out of sale, never deleted; the price of a format in promotion is refused, edit it on the format's own sheet). Listed in `AUDITED_WRITE_RPCS`; audit trigger records the format columns.
- Admin catalogue list hides child rows and shows « N formats » on the base. A child sheet shows an info banner and a read-only stock.
- Help Center guide `formats-de-vente` (FR/IT/EN, seed only: republication is an editorial action).

## 7. Out of scope (v1)

- Selling the lot while the single is off sale (the base row's `active` governs the whole product page).
- Nala proposes the base format at its minimum; it never proposes a lot.
- Assisted-order staff picker: a child appears under its full name; stock and snapshot are handled by RPC 128 like any line.

## 8. Rollout runbook

1. **Demo first**: apply 187 on the demo database (`lepefy-demo`, workflow `Demo database` / SQL editor), configure a demo product with a lot, check catalogue (one card), product page, cart swap, checkout (test mode), order documents.
2. **Production migration**: needs explicit approval. Apply 187 **before** deploying the code (the card projection reads `sale_formats` and the new columns, like 156). Check: `select count(*) from products where format_parent_id is not null` = 0; `select proname from pg_proc where proname in ('sale_formats','set_product_sale_formats')`.
3. **Deploy** the code; nothing changes for any tenant until a format is created.
4. **Pilot (Chloe Food, « Arachides dépulpés (Ndole) »)**: only with the tenant's confirmation of the lot price (reference proposed: the current total of 3 packs; with that price no savings badge appears) and explicit authorization. In the product sheet: base label « 1 paquet », « Règles de vente » minimum 1, add « Lot de 3 paquets », 3 units, price, packed weight of 3 packs. Open orders are untouched.

## 9. Turning the new purchase off

- Untick « En vente » on the lot and save (or `PUT` without it): the lot leaves the page; saved carts show « produit indisponible » and checkout refuses it; the stock stays on the base; open orders keep their snapshot (format, units) and are prepared normally. Optionally restore the single's previous minimum. Never delete a format row.
- Code rollback: revert the commit (no data loss). Database rollback only if required: first set every child out of sale, then reapply 029 / 162 §2 / 109 / 156 §5 / 156 §6 functions (see the header of 187). Columns and snapshots may stay.

## 10. Measuring the pilot (no dashboard)

```sql
-- Share of lots vs singles (paid, non-test, not cancelled) for one base product.
select oi.format_snapshot->>'format_label' as format, count(*) as lines, sum(oi.quantity) as sold,
       sum(oi.quantity * coalesce((oi.format_snapshot->>'units_per_sale')::int, 1)) as units
from order_items oi join orders o on o.id = oi.order_id
where o.tenant_id = :tenant and o.payment_status = 'paid' and not o.is_test and o.status not in ('cancelled','stock_conflict')
  and (oi.product_id = :base or oi.format_snapshot->>'stock_product_id' = :base::text)
group by 1;

-- Single shipped alone vs single in a mixed cart (delivery orders containing the base format).
select basket, count(*) as orders from (
  select o.id, case when count(oi.id) = 1 then 'alone' else 'mixed' end as basket
  from orders o join order_items oi on oi.order_id = o.id
  where o.tenant_id = :tenant and o.payment_status = 'paid' and not o.is_test and o.fulfillment_type = 'delivery'
    and o.status not in ('cancelled','stock_conflict')
    and exists (select 1 from order_items x where x.order_id = o.id and x.product_id = :base)
  group by o.id
) t group by basket;
```

Margin after carrier and packaging: join `orders.shipping_details` (provider cost when stored) and `packaging_surcharges`; report only where the costs are known.
