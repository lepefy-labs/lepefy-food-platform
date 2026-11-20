import { test, expect } from '@playwright/test';
import type { CartItem } from '@lepefy/types';
import { buildSaleFormatOptions } from '../../src/lib/catalog/saleFormats';
import { buildCartSummaryLines } from '../../src/lib/cart/cartSummaryLines';
import { selectCartItemCount } from '../../src/lib/cart/cartSelectors';

const parent = {
  id: 'bobolo', name: 'Bobolo sous vide', price: 3, stock: 992, format_label: '1 paquet', sale_unit: 'paquet', net_quantity_display: '500 g',
  formats: [
    { id: 'c20', price: 45.9, stock: 145, active: true, format_parent_id: 'bobolo', units_per_sale: 20, format_label: 'Carton de 20 paquets', format_position: 1, format_stock_mode: 'own' },
  ],
};
const options = buildSaleFormatOptions(parent);
const item = (id: string, name: string, price: number, quantity: number, units = 1): CartItem => ({
  product: { id, name, slug: id, price, image_url: null, weight_grams: 500, stock: 99, units_per_sale: units } as CartItem['product'],
  quantity,
});

test('le récapitulatif du checkout regroupe une fiche à formats comme le panier', () => {
  const items = [item('c20', 'Bobolo sous vide — Carton de 20 paquets', 45.9, 2, 20), item('bobolo', 'Bobolo sous vide', 3, 9), item('malta', 'Malta Guinness', 2.5, 2)];
  const groups = new Map([['bobolo', { parent, options, ids: options.map((option) => option.id) }]]);
  expect(buildCartSummaryLines(items, groups).map((line) => ({ ...line, detail: line.detail?.replace(/[  ]/g, ' ') ?? null }))).toEqual([
    { key: 'bobolo', label: 'Bobolo sous vide · 49 paquets', total: 118.8, detail: 'dont 2 cartons de 20 paquets · −28,20 €' },
    { key: 'malta', label: '2× Malta Guinness', total: 5, detail: null },
  ]);
  // Même compte que le badge et le panier : 2 cartons de 20 + 9 paquets + 2 bouteilles.
  expect(selectCartItemCount({ items })).toBe(51);
});

test('sans formats lus, les lignes restent celles du panier', () => {
  const items = [item('c20', 'Carton', 45.9, 1, 20), item('bobolo', 'Bobolo sous vide', 3, 2)];
  expect(buildCartSummaryLines(items, new Map()).map((line) => line.label)).toEqual(['1× Carton', '2× Bobolo sous vide']);
  // Fiche à formats sans lot dans le panier : pas de composition.
  const groups = new Map([['bobolo', { parent, options, ids: options.map((option) => option.id) }]]);
  expect(buildCartSummaryLines([item('bobolo', 'Bobolo sous vide', 3, 2)], groups)).toEqual([
    { key: 'bobolo', label: 'Bobolo sous vide · 2 paquets', total: 6, detail: null },
  ]);
});
