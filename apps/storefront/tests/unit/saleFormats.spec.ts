import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  aggregateStockDemand,
  buildSaleFormatOptions,
  formatQuantityLabel,
  formatSavings,
  lowestUnitPrice,
  proposeFormatSwap,
  type SaleFormatParent,
} from '../../src/lib/catalog/saleFormats';
import { parseSaleFormatsBody, saleFormatRpcError, saleFormatSlugBase, saleFormatWarnings } from '../../src/lib/catalog/saleFormatsAdmin';
import { orderItemFormatLabel, orderItemPhysicalUnits } from '../../src/lib/orders/documents/itemFormat';
import { saleFormatCardChip, saleFormatSavingsLine, saleFormatUnitPriceLine } from '../../src/lib/storefrontCopy/saleFormatCopy';
import { resolveSellingFormat } from '../../src/lib/storefrontCopy/sellingFormat';

// Demo prices only (pilot price is the tenant's decision).
function ndole(stock: number, lot: Partial<NonNullable<SaleFormatParent['formats']>[number]> = {}): SaleFormatParent {
  return {
    id: 'base', price: 3.5, stock, min_order_quantity: 1, order_quantity_step: 1, format_label: '1 paquet',
    formats: [{
      id: 'lot', price: 9.9, stock: Math.floor(stock / 3), active: true, min_order_quantity: 1, order_quantity_step: 1,
      format_parent_id: 'base', units_per_sale: 3, format_label: 'Lot de 3 paquets', format_position: 1, format_stock_mode: 'shared',
      ...lot,
    }],
  };
}

const paquet = resolveSellingFormat({ sale_unit: 'paquet', net_quantity_display: '500 g' });

test('legacy product without formats keeps the single-format behaviour', () => {
  expect(buildSaleFormatOptions({ id: 'p', price: 2, stock: 5 })).toEqual([]);
  expect(buildSaleFormatOptions({ id: 'p', price: 2, stock: 5, formats: [] })).toEqual([]);
  // An inactive format does not turn the product into a multi-format one.
  expect(buildSaleFormatOptions(ndole(7, { active: false }))).toEqual([]);
});

test('Ndole: single from 1, lot of 3 selectable, no preselection data, savings only when positive', () => {
  const options = buildSaleFormatOptions(ndole(7));
  expect(options.map((o) => [o.id, o.label, o.units, o.minimum, o.maxPurchasable])).toEqual([
    ['base', '1 paquet', 1, 1, 7],
    ['lot', 'Lot de 3 paquets', 3, 1, 2],
  ]);
  expect(options[1]!.unitPrice).toBe(3.3);
  expect(options[1]!.savings).toBe(0.6);
  expect(lowestUnitPrice(options)).toBe(3.3);
  // Reference pilot price = 3 singles: no savings shown.
  expect(buildSaleFormatOptions(ndole(7, { price: 10.5 }))[1]!.savings).toBe(0);
  expect(formatSavings(3.5, 3, 11)).toBe(0);
  expect(saleFormatSavingsLine(options[1]!, paquet)).toBe('Économisez 0,60 € par rapport à 3 paquets à l’unité');
  expect(saleFormatUnitPriceLine(options[1]!, paquet)).toBe('3,30 € le paquet de 500 g');
  expect(saleFormatCardChip(options)).toBe('2 formats · lot de 3 paquets à 9,90 €');
});

test('a lot below its units is sold out while the single stays purchasable', () => {
  const options = buildSaleFormatOptions(ndole(2));
  expect(options[0]!.purchasable).toBe(true);
  expect(options[1]!.purchasable).toBe(false);
  expect(saleFormatCardChip(options)).toBe('lot de 3 paquets épuisé');
});

test('stock 7: 2 lots + 1 single = 7 packs, 2 lots + 2 singles = 8 packs', () => {
  const lot = { id: 'lot', format_parent_id: 'base', units_per_sale: 3, format_stock_mode: 'shared' };
  const base = { id: 'base' };
  expect(aggregateStockDemand([
    { productId: 'lot', quantity: 2, row: lot }, { productId: 'base', quantity: 1, row: base },
  ]).get('base')).toBe(7);
  expect(aggregateStockDemand([
    { productId: 'lot', quantity: 2, row: lot }, { productId: 'base', quantity: 2, row: base },
  ]).get('base')).toBe(8);
  // Own stock (separate cartons) is never added to the parent.
  const own = aggregateStockDemand([{ productId: 'c', quantity: 1, row: { id: 'c', format_parent_id: 'base', units_per_sale: 12, format_stock_mode: 'own' } }]);
  expect(own.get('c')).toBe(1);
  expect(own.has('base')).toBe(false);
});

test('swap proposal: 3 singles → 1 lot, same packs, only when cheaper and purchasable', () => {
  const options = buildSaleFormatOptions(ndole(7));
  const swap = proposeFormatSwap({ productId: 'base', quantity: 3, price: 3.5, minimum: 1, step: 1 }, options, new Map([['base', 3]]));
  expect(swap).toEqual({ baseId: 'base', formatId: 'lot', baseQuantity: 0, formatQuantity: 1, label: 'Lot de 3 paquets', units: 3, savings: 0.6 });
  // 7 singles → 2 lots + 1 single.
  expect(proposeFormatSwap({ productId: 'base', quantity: 7, price: 3.5, minimum: 1, step: 1 }, options, new Map())?.baseQuantity).toBe(1);
  // Fewer than 3 singles, not cheaper, sold out: nothing.
  expect(proposeFormatSwap({ productId: 'base', quantity: 2, price: 3.5, minimum: 1, step: 1 }, options, new Map())).toBeNull();
  expect(proposeFormatSwap({ productId: 'base', quantity: 3, price: 3.5, minimum: 1, step: 1 }, buildSaleFormatOptions(ndole(7, { price: 10.5 })), new Map())).toBeNull();
  expect(proposeFormatSwap({ productId: 'base', quantity: 3, price: 3.5, minimum: 1, step: 1 }, buildSaleFormatOptions(ndole(2)), new Map())).toBeNull();
  // Remaining singles would break the base rule (minimum 3): not proposed.
  expect(proposeFormatSwap({ productId: 'base', quantity: 4, price: 3.5, minimum: 3, step: 1 }, options, new Map())).toBeNull();
});

test('quantity labels are never ambiguous', () => {
  expect(formatQuantityLabel('1 paquet', 1)).toBe('1 paquet');
  expect(formatQuantityLabel('1 paquet', 2)).toBe('2 paquets');
  expect(formatQuantityLabel('Lot de 3 paquets', 1)).toBe('1 lot de 3 paquets');
  expect(formatQuantityLabel('Lot de 3 paquets', 2)).toBe('2 lots de 3 paquets');
});

test('order documents read the frozen v2 snapshot: label, content, physical units', () => {
  const lot = { v: 2, format_label: 'Lot de 3 paquets', units_per_sale: 3, sale_unit: 'paquet', net_quantity_display: '500 g', stock_product_id: 'x' };
  expect(orderItemFormatLabel(lot, 'Arachides dépulpés (Ndole) — Lot de 3 paquets')).toBe('3 × 500 g');
  expect(orderItemPhysicalUnits(lot, 2)).toBe('6 paquets');
  const single = { v: 2, format_label: '1 paquet', units_per_sale: 1, sale_unit: 'paquet', net_quantity_display: '500 g' };
  expect(orderItemFormatLabel(single, 'Arachides dépulpés (Ndole)')).toBe('1 paquet · 500 g');
  expect(orderItemPhysicalUnits(single, 4)).toBeNull();
  // v1 snapshots keep their historical output.
  expect(orderItemFormatLabel({ v: 1, sale_unit: 'sachet', net_content_value: 150, net_content_unit: 'g' }, 'Kaolin')).toBe('150 g');
});

test('admin body parsing, slugs, warnings and RPC errors', () => {
  const ok = parseSaleFormatsBody({ baseLabel: '1 paquet', formats: [{ label: 'Lot de 3 paquets', units_per_sale: 3, price: 9.9, weight_grams: 1520 }] });
  expect(ok.ok).toBe(true);
  expect(parseSaleFormatsBody({ baseLabel: '', formats: [{ label: 'Lot', units_per_sale: 3, price: 9.9 }] }).ok).toBe(false);
  expect(parseSaleFormatsBody({ baseLabel: '1 paquet', formats: [{ label: '1 paquet', units_per_sale: 3, price: 9.9 }] }).ok).toBe(false);
  expect(parseSaleFormatsBody({ baseLabel: '1 paquet', formats: [{ label: 'Lot', units_per_sale: 1, price: 9.9 }] }).ok).toBe(false);
  expect(parseSaleFormatsBody({ baseLabel: '1 paquet', formats: [{ label: 'Lot', units_per_sale: 3, price: 9.999 }] }).ok).toBe(false);
  expect(saleFormatSlugBase('arachides-depulpes-ndole', 'Lot de 3 paquets')).toBe('arachides-depulpes-ndole-lot-de-3-paquets');

  const warnings = saleFormatWarnings({
    base: { min_order_quantity: 3, order_quantity_step: 1, stock: 291, weight_grams: 500 },
    basePrice: 3.5,
    formats: [{ label: 'Lot de 3 paquets', units_per_sale: 3, weight_grams: 1520, active: true, price: 10.5 }],
    groups: [{ name: 'Épicerie sèche', min_quantity: 6 }],
  });
  expect(warnings.some((w) => w.includes('minimum de 3'))).toBe(true);
  expect(warnings.some((w) => w.includes('« Épicerie sèche »'))).toBe(true);
  expect(warnings.some((w) => w.includes('aucune économie'))).toBe(true);
  expect(saleFormatWarnings({ base: { min_order_quantity: 1, order_quantity_step: 1, stock: 291, weight_grams: 500 }, basePrice: 3.5,
    formats: [{ label: 'Lot', units_per_sale: 3, weight_grams: 1520, active: true, price: 9.9 }], groups: [] })).toEqual([]);

  expect(saleFormatRpcError('format_price_promotion_active').status).toBe(400);
  expect(saleFormatRpcError('Could not find the function public.set_product_sale_formats in the schema cache').status).toBe(503);
});

// One card per product: every public listing excludes format rows.
test('public listing queries exclude sale format rows', () => {
  const root = join(__dirname, '../../src');
  const listings = [
    'lib/catalog/pagination.ts', 'lib/catalog/catalogCache.ts', 'lib/catalog/getRelatedProducts.ts', 'lib/catalog/novelties.ts',
    'lib/catalog/promotions.ts', 'lib/catalog/similarProducts.ts', 'lib/catalog/addOnShelf.ts', 'lib/catalog/productRelationships.ts',
    'lib/card/getCardShowcaseProducts.ts', 'app/api/cart/suggestions/route.ts', 'app/(shop)/accueil/page.tsx', 'app/(shop)/gadgets/page.tsx',
    'lib/ai/nalaProductActions.ts', 'app/api/chat/route.ts', 'lib/catalog/catalogueList.ts',
  ];
  for (const file of listings) {
    const source = readFileSync(join(root, file), 'utf8');
    const queries = source.split(".from('products')").length - 1;
    const filters = source.split("format_parent_id', null").length - 1;
    expect(filters, `${file} lists products without excluding sale formats`).toBeGreaterThan(0);
    expect(queries).toBeGreaterThan(0);
  }
  const migration = readFileSync(join(root, '../../../supabase/migrations/187_product_sale_formats.sql'), 'utf8');
  expect(migration).toContain('and p.format_parent_id is null');
});
