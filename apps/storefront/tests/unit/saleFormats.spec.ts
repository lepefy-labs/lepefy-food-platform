import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import {
  aggregateStockDemand,
  buildSaleFormatOptions,
  cheaperWithMoreUnits,
  decrementPriceRise,
  formatQuantityLabel,
  formatSavings,
  lowestUnitPrice,
  describeBundle,
  maxBundleUnits,
  planFormatBundle,
  type SaleFormatParent,
} from '../../src/lib/catalog/saleFormats';
import {
  attachBlocker,
  attachConsequences,
  parseAttachSaleFormatBody,
  parseSaleFormatsBody,
  saleFormatRpcError,
  saleFormatSlugBase,
  saleFormatWarnings,
  type AttachCandidate,
} from '../../src/lib/catalog/saleFormatsAdmin';
import { orderItemFormatLabel, orderItemPhysicalUnits } from '../../src/lib/orders/documents/itemFormat';
import { bundleCaption, cheaperWithMoreLine, decrementPriceRiseLine, saleFormatCardChip, saleFormatOfferLine, saleFormatSavingsLine, saleFormatUnitPriceLine } from '../../src/lib/storefrontCopy/saleFormatCopy';
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

test('un seul prix de référence par format : le prix barré l’emporte sur la comparaison aux unités', () => {
  // Bobolo carton de 20 : 45,90 € barré 59,90 €, 20 paquets à 3,00 € = 60,00 €.
  const [base, , carton20] = buildSaleFormatOptions({
    id: 'bobolo', price: 3, stock: 992, format_label: '1 paquet',
    formats: [
      { id: 'c10', price: 25.9, stock: 142, active: true, format_parent_id: 'bobolo', units_per_sale: 10, format_label: 'Carton de 10 paquets', format_position: 1, format_stock_mode: 'own' },
      { id: 'c20', price: 45.9, compare_at_price: 59.9, stock: 145, active: true, format_parent_id: 'bobolo', units_per_sale: 20, format_label: 'Carton de 20 paquets', format_position: 2, format_stock_mode: 'own' },
    ],
  });
  expect(sp(saleFormatSavingsLine(carton20!, paquet)!)).toBe('Économisez 14,00 €');
  // Sans prix barré : la comparaison aux unités reste ; la base sans promotion n'a rien.
  expect(saleFormatSavingsLine(base!, paquet)).toBeNull();
  expect(sp(saleFormatSavingsLine({ ...carton20!, compareAtPrice: null }, paquet)!)).toBe('Économisez 14,10 € par rapport à 20 paquets à l’unité');
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

test('automatic bundling: the customer counts packs, the cart picks the cheapest combination', () => {
  const options = buildSaleFormatOptions(ndole(291, { price: 10 }));
  const shape = (n: number) => planFormatBundle(n, options)!.lines.map((l) => [l.option.id, l.quantity]);
  expect(shape(1)).toEqual([['base', 1]]);
  expect(shape(2)).toEqual([['base', 2]]);
  expect(shape(3)).toEqual([['lot', 1]]);
  expect(shape(4)).toEqual([['base', 1], ['lot', 1]]);
  expect(shape(6)).toEqual([['lot', 2]]);
  expect(planFormatBundle(4, options)!.total).toBe(13.5);
  expect(planFormatBundle(4, options)!.savings).toBe(0.5);
  expect(describeBundle(planFormatBundle(7, options)!)).toBe('2 lots de 3 paquets + 1 paquet');
  expect(planFormatBundle(0, options)).toEqual({ units: 0, lines: [], total: 0, savings: 0 });
  // A lot that saves nothing is never imposed (equal cost keeps singles).
  expect(planFormatBundle(3, buildSaleFormatOptions(ndole(291, { price: 10.5 })))!.lines.map((l) => l.option.id)).toEqual(['base']);
  // Lot sold out (stock 2): singles only; stock caps the counter.
  expect(planFormatBundle(2, buildSaleFormatOptions(ndole(2)))!.lines.map((l) => [l.option.id, l.quantity])).toEqual([['base', 2]]);
  expect(maxBundleUnits(buildSaleFormatOptions(ndole(7)))).toBe(7);
  expect(planFormatBundle(3, buildSaleFormatOptions(ndole(2)))).toBeNull();
});

test('several lot sizes: optimal, not greedy', () => {
  const parent: SaleFormatParent = {
    id: 'base', price: 1, stock: 100, format_label: '1 pièce',
    formats: [
      { id: 'l4', price: 3.6, stock: 25, active: true, format_parent_id: 'base', units_per_sale: 4, format_label: 'Lot de 4', format_position: 1 },
      { id: 'l5', price: 4, stock: 20, active: true, format_parent_id: 'base', units_per_sale: 5, format_label: 'Lot de 5', format_position: 2 },
    ],
  };
  // 8 pieces: lot de 5 + 3 pieces (7,00 €) is cheaper than 2 lots de 4 (7,20 €); greedy-by-size would miss neither, cost decides.
  const plan = planFormatBundle(8, buildSaleFormatOptions(parent))!;
  expect(plan.total).toBe(7);
  expect(planFormatBundle(9, buildSaleFormatOptions(parent))!.total).toBe(7.6);
});

test('card and cart copy: offer line and composition caption', () => {
  const options = buildSaleFormatOptions(ndole(291, { price: 10 }));
  expect(saleFormatOfferLine(options)).toBe('3 pour 10,00 €');
  expect(saleFormatOfferLine(buildSaleFormatOptions(ndole(291, { price: 10.5 })))).toBeNull();
  expect(bundleCaption(planFormatBundle(4, options), options, paquet)).toBe('dont 1 lot de 3 paquets · −0,50 €');
  expect(bundleCaption(planFormatBundle(2, options), options, paquet)).toBe('Encore 1 paquet : les 3 à 10,00 €');
  expect(bundleCaption(null, options, paquet)).toBe('dans le panier');
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

// One card per product: every public listing excludes format rows. Exception: promotions.ts
// keeps a format in promotion (its card links to the base page, `resolvePromotionFormats`) and
// filters `format_parent_id` on the base lookup.
test('public listing queries exclude sale format rows', () => {
  const root = join(__dirname, '../../src');
  const listings = [
    'lib/catalog/pagination.ts', 'lib/catalog/catalogCache.ts', 'lib/catalog/getRelatedProducts.ts', 'lib/catalog/novelties.ts',
    'lib/catalog/promotions.ts', 'lib/catalog/similarProducts.ts', 'lib/catalog/addOnShelf.ts', 'lib/catalog/productRelationships.ts',
    'lib/card/getCardShowcaseProducts.ts', 'app/api/cart/suggestions/route.ts', 'app/(shop)/accueil/page.tsx', 'app/(shop)/gadgets/page.tsx',
    'lib/ai/nalaProductActions.ts', 'app/api/chat/route.ts',
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
  // Admin list (not public): base rows plus own-stock formats, on every query including the search.
  const adminList = readFileSync(join(root, 'lib/catalog/catalogueList.ts'), 'utf8');
  expect(adminList).toContain("format_parent_id.is.null,format_stock_mode.eq.own");
  expect(adminList.split('CATALOGUE_ROW_FILTER').length - 1).toBeGreaterThanOrEqual(4);
});

test.describe('Rattacher un produit existant comme format (188)', () => {
  const carton: AttachCandidate = {
    id: '0b6c4a52-1d1e-4c39-9f53-0d5d8a6f1a10', name: 'Bobolo carton de 10', slug: 'bobolo-carton-10', price: 25.9, compare_at_price: 30,
    stock: 142, active: true, featured: true, min_order_quantity: 2, order_quantity_step: 2, add_on_position: 3, image_url: null,
    format_parent_id: null, has_formats: false,
  };

  test('corps du POST : produit, nom, unités ; stock propre par défaut', () => {
    const ok = parseAttachSaleFormatBody({ productId: carton.id, label: ' Carton de 10 paquets ', units_per_sale: 10 });
    expect(ok).toEqual({ ok: true, body: { productId: carton.id, label: 'Carton de 10 paquets', units_per_sale: 10, stock_mode: 'own', baseLabel: '' } });
    expect(parseAttachSaleFormatBody({ productId: 'x', label: 'A', units_per_sale: 3 }).ok).toBe(false);
    expect(parseAttachSaleFormatBody({ productId: carton.id, label: '', units_per_sale: 3 }).ok).toBe(false);
    expect(parseAttachSaleFormatBody({ productId: carton.id, label: 'A', units_per_sale: 1 }).ok).toBe(false);
    expect(parseAttachSaleFormatBody({ productId: carton.id, label: 'Lot', units_per_sale: 3, baseLabel: 'lot' }).ok).toBe(false);
    const shared = parseAttachSaleFormatBody({ productId: carton.id, label: 'Lot', units_per_sale: 3, stock_mode: 'shared' });
    expect(shared.ok && shared.body.stock_mode).toBe('shared');
  });

  test('pas rattachable : la fiche elle-même, un format, un produit qui a des formats', () => {
    expect(attachBlocker(carton, 'parent')).toBeNull();
    expect(attachBlocker(carton, carton.id)).not.toBeNull();
    expect(attachBlocker({ ...carton, format_parent_id: 'autre' }, 'parent')).not.toBeNull();
    expect(attachBlocker({ ...carton, has_formats: true }, 'parent')).not.toBeNull();
  });

  test('la confirmation dit tout ce qui change, rien en silence', () => {
    const lines = attachConsequences({ candidate: carton, parent: { name: 'Bobolo sous vide', stock: 30 }, label: 'Carton de 10', units: 10, stockMode: 'own' });
    expect(lines[0]).toContain('« Bobolo sous vide — Carton de 10 »');
    expect(lines.join(' ')).toContain('stock propre : 142');
    expect(lines.join(' ')).toContain('promotion est conservée');
    expect(lines.join(' ')).toContain('quantité minimale (2)');
    expect(lines.join(' ')).toContain('plus mis en avant');
    expect(lines.join(' ')).toContain('Petits plus');
    const plain = attachConsequences({
      candidate: { ...carton, stock: 0, compare_at_price: null, featured: false, min_order_quantity: 1, order_quantity_step: 1, add_on_position: null },
      parent: { name: 'Ndole', stock: 7 }, label: 'Lot de 3', units: 3, stockMode: 'shared',
    });
    expect(plain).toHaveLength(3);
    expect(plain[2]).toContain('2 disponibles');
  });

  test('erreurs de la RPC 188 en français', () => {
    expect(saleFormatRpcError('format_attach_stock_not_empty').status).toBe(400);
    expect(saleFormatRpcError('format_attach_already_format').status).toBe(409);
    expect(saleFormatRpcError('format_detach_shared').error).toContain('hors vente');
    expect(saleFormatRpcError('Could not find the function public.attach_product_as_sale_format in the schema cache'))
      .toEqual({ status: 503, error: 'Fonction indisponible : la migration 188 n’est pas encore appliquée.' });
  });
});

/** Prix « 117,70 € » : espace insécable d'Intl ramené à un espace simple pour comparer. */
const sp = (text: string) => text.replace(/[  ]/g, ' ');

test.describe('Une unité de moins ne coûte jamais plus sans le dire', () => {
  // Bobolo (Chloe Food, 20/11/2026) : 1 paquet 3,00 €, carton de 10 à 25,90 €, carton de 20 à 45,90 € (stock propre).
  const bobolo = buildSaleFormatOptions({
    id: 'bobolo', price: 3, stock: 992, format_label: '1 paquet', weight_grams: 500,
    formats: [
      { id: 'c10', price: 25.9, stock: 142, active: true, format_parent_id: 'bobolo', units_per_sale: 10, format_label: 'Carton de 10 paquets', format_position: 1, format_stock_mode: 'own', weight_grams: 6500 },
      { id: 'c20', price: 45.9, stock: 145, active: true, format_parent_id: 'bobolo', units_per_sale: 20, format_label: 'Carton de 20 paquets', format_position: 2, format_stock_mode: 'own', weight_grams: 12000 },
    ],
  });

  test('49 paquets (118,80 €) : 1 de plus fait 117,70 €', () => {
    const plan49 = planFormatBundle(49, bobolo)!;
    expect(plan49.total).toBe(118.8);
    // 50 paquets pèsent 2 kg de plus (carton de 10 = 6,5 kg contre 9 paquets = 4,5 kg).
    const current = { currentLines: plan49.lines };
    expect(cheaperWithMoreUnits(49, plan49.total, bobolo, 999, { ...current, weightBudgetG: 3000 })).toEqual({ extra: 1, units: 50, total: 117.7 });
    // Marge de 1,5 kg (forfait Italie, 30 kg par colis) : un 2e colis coûterait 10,40 € de plus, rien n'est proposé.
    expect(cheaperWithMoreUnits(49, plan49.total, bobolo, 999, { ...current, weightBudgetG: 1500 })).toBeNull();
    // Estimation inconnue : seulement sans poids ajouté.
    expect(cheaperWithMoreUnits(49, plan49.total, bobolo, 999, current)).toBeNull();
    // Livraison offerte : la marge est illimitée.
    expect(cheaperWithMoreUnits(49, plan49.total, bobolo, 999, { ...current, weightBudgetG: Number.POSITIVE_INFINITY })?.units).toBe(50);
    expect(sp(cheaperWithMoreLine({ extra: 1, units: 50, total: 117.7 }, 118.8, paquet))).toBe('Avec 1 paquet de plus : 117,70 € au lieu de 118,80 €');
  });

  test('rien à proposer quand plus coûte plus, ou au-delà du stock', () => {
    const plan41 = planFormatBundle(41, bobolo)!;
    expect(cheaperWithMoreUnits(41, plan41.total, bobolo, 999, { currentLines: plan41.lines, weightBudgetG: 99999 })).toBeNull();
    expect(cheaperWithMoreUnits(49, 118.8, bobolo, 49, { currentLines: planFormatBundle(49, bobolo)!.lines, weightBudgetG: 99999 })).toBeNull();
    // Ndole : 2 paquets à 7,00 € contre le lot de 3 à 9,90 € : pas moins cher.
    const ndoleOptions = buildSaleFormatOptions(ndole(7));
    expect(cheaperWithMoreUnits(2, 7, ndoleOptions, 7, { weightBudgetG: 99999 })).toBeNull();
  });

  test('le « − » qui fait perdre un lot est annoncé avant, avec le montant', () => {
    // 11 paquets = carton de 10 + 1 paquet (28,90 €) → 10 = carton seul (25,90 €) : baisse, rien à dire.
    expect(decrementPriceRise(11, planFormatBundle(11, bobolo)!.total, bobolo)).toBeNull();
    // 10 (25,90 €) → 9 paquets (27,00 €) : 1,10 € de plus.
    const rise = decrementPriceRise(10, 25.9, bobolo)!;
    expect(rise).toEqual({ fromUnits: 10, units: 9, currentTotal: 25.9, total: 27, extra: 1.1 });
    expect(sp(decrementPriceRiseLine(rise, paquet))).toBe('À 9 paquets, vous paieriez 27,00 € au lieu de 25,90 €, soit 1,10 € de plus.');
    // Sans unité structurée : « unités », jamais un nombre nu (« À 9, vous paieriez »).
    expect(sp(decrementPriceRiseLine(rise, resolveSellingFormat({})))).toBe('À 9 unités, vous paieriez 27,00 € au lieu de 25,90 €, soit 1,10 € de plus.');
    // Dernière unité (retrait) et produit à format unique : jamais d'avis.
    expect(decrementPriceRise(1, 3, bobolo)).toBeNull();
    expect(decrementPriceRise(5, 15, bobolo.slice(0, 1))).toBeNull();
  });

  test('même prix : dit sans prétendre une économie', () => {
    expect(sp(cheaperWithMoreLine({ extra: 1, units: 3, total: 7 }, 7, paquet))).toBe('Avec 1 paquet de plus : même prix, 7,00 €');
  });
});
