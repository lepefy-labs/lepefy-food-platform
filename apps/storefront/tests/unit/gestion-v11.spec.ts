import { expect, test } from '@playwright/test';
import {
  canonicalConversion, canonicalQuantity, costPerStockUnit, parseQuantity, quantityToString, remainingQuantity, stockUnitsFor,
  parseConversion,
} from '../../src/lib/gestion/quantity';
import { formatDate, formatDateTime, formatQuantity, formatQuantityWithUnit, formatStockUnits } from '../../src/lib/gestion/format';
import {
  addDays, dueInfo, dueLabel, gestionToday, indicativeMargin, paymentTermsLabel, receiptProgress, receivedAtForDate, summarizeDues,
} from '../../src/lib/gestion/domain';
import { adjustmentSchema, createPurchaseSchema, receiptSchema } from '../../src/lib/gestion/schemas';
import { gestionApiPermission } from '../../src/lib/gestion/permissions';
import { permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const uuid = '11111111-1111-4111-8111-111111111111';

// ─── Quantités décimales ─────────────────────────────────────────────────────

test('decimal quantities parse exactly, with comma or dot, never rounded', () => {
  expect(parseQuantity('12,5')).toBe(BigInt(12500));
  expect(parseQuantity('2.75')).toBe(BigInt(2750));
  expect(parseQuantity('0.125')).toBe(BigInt(125));
  expect(parseQuantity(12.5)).toBe(BigInt(12500));
  expect(parseQuantity('12.000')).toBe(BigInt(12000));
  expect(parseQuantity('1.2345')).toBeNull(); // 4 décimales : refus, jamais d'arrondi
  expect(parseQuantity('-1')).toBeNull();
  expect(parseQuantity('abc')).toBeNull();
  expect(canonicalQuantity('12,50')).toBe('12.5');
  expect(canonicalQuantity('7')).toBe('7');
});

test('partial receipts add up without floating point error (5 + 7,5 = 12,5)', () => {
  const received = (parseQuantity('5') ?? BigInt(0)) + (parseQuantity('7.5') ?? BigInt(0));
  expect(quantityToString(received)).toBe('12.5');
  expect(remainingQuantity(parseQuantity('12.5')!, received)).toBe(BigInt(0));
  // 0,1 + 0,2 en flottant vaut 0,30000000000000004 ; en millièmes c'est exact.
  expect(quantityToString(parseQuantity('0.1')! + parseQuantity('0.2')!)).toBe('0.3');
  expect(quantityToString(remainingQuantity(parseQuantity('12.5')!, parseQuantity('5')!))).toBe('7.5');
});

test('formatQuantity shows fr-FR decimals only when needed', () => {
  const norm = (value: string) => value.replace(/ | /g, ' ');
  expect(formatQuantity(12)).toBe('12');
  expect(formatQuantity(12.5)).toBe('12,5');
  expect(formatQuantity(12.75)).toBe('12,75');
  expect(formatQuantity(12.375)).toBe('12,375');
  expect(formatQuantity('12.000')).toBe('12');
  expect(norm(formatQuantity(1234.5))).toBe('1 234,5');
  expect(formatQuantityWithUnit(12.5, 'kg')).toBe('12,5 kg');
  expect(formatQuantityWithUnit(3, 'carton')).toBe('3 cartons');
  expect(formatQuantityWithUnit(1, 'unit')).toBe('1 unité');
  expect(formatQuantityWithUnit(0.75, 'l')).toBe('0,75 L');
  expect(formatStockUnits(25)).toBe('25 unités');
});

// ─── Conversion vers le stock ────────────────────────────────────────────────

test('stock conversion: 12,5 kg x 2 = 25 units, 10 cartons x 12 = 120', () => {
  expect(stockUnitsFor(parseQuantity('12.5')!, parseConversion('2')!)).toEqual({ units: BigInt(25), exact: true });
  expect(stockUnitsFor(parseQuantity('5')!, parseConversion('2')!)).toEqual({ units: BigInt(10), exact: true });
  expect(stockUnitsFor(parseQuantity('10')!, parseConversion('12')!)).toEqual({ units: BigInt(120), exact: true });
  expect(stockUnitsFor(parseQuantity('1000')!, parseConversion('0.002')!)).toEqual({ units: BigInt(2), exact: true }); // 1 000 g, 1 unité / 500 g
  expect(stockUnitsFor(parseQuantity('750')!, parseConversion('0.002')!).exact).toBe(false); // 750 g = 1,5 unité : refusé
});

test('integer-stock validation rejects 3,5 x 1 instead of rounding', () => {
  expect(stockUnitsFor(parseQuantity('3.5')!, parseConversion('1')!).exact).toBe(false);
  expect(stockUnitsFor(parseQuantity('2.75')!, parseConversion('2')!).exact).toBe(false);
  expect(canonicalConversion('0')).toBeNull();
  expect(canonicalConversion('1.0000001')).toBeNull();
  expect(canonicalConversion('2')).toBe('2');
});

test('cost per stock unit: 8 EUR/kg with 2 units/kg = 4 EUR, half-up to 4 decimals', () => {
  expect(costPerStockUnit(8, 2)).toBe('4');
  expect(costPerStockUnit('10', '2')).toBe('5');
  expect(costPerStockUnit('24', '12')).toBe('2');
  expect(costPerStockUnit('1', '3')).toBe('0.3333');
  expect(costPerStockUnit('2', '3')).toBe('0.6667');
  expect(costPerStockUnit('5', '0')).toBeNull();
});

test('API schemas carry canonical decimal strings, units and conversions', () => {
  const purchase = createPurchaseSchema.parse({
    supplier_id: uuid, requestKey: 'request-key-0001',
    items: [{ product_id: uuid, ordered_quantity: '12,5', purchase_unit: 'kg', stock_units_per_purchase_unit: '2', unit_cost: 8 }],
  });
  expect(purchase.items[0]).toMatchObject({ ordered_quantity: '12.5', purchase_unit: 'kg', stock_units_per_purchase_unit: '2' });
  expect(createPurchaseSchema.safeParse({ supplier_id: uuid, requestKey: 'request-key-0001',
    items: [{ description: 'X', ordered_quantity: '1.2345', unit_cost: 1 }] }).success).toBe(false);
  expect(createPurchaseSchema.safeParse({ supplier_id: uuid, requestKey: 'request-key-0001',
    items: [{ description: 'X', ordered_quantity: '1', purchase_unit: 'tonne', unit_cost: 1 }] }).success).toBe(false);
  const receipt = receiptSchema.parse({ items: [{ purchase_item_id: uuid, quantity: 7.5 }], requestKey: 'receipt-key-0001' });
  expect(receipt.items[0]?.quantity).toBe('7.5');
});

test('manual adjustment requires an integer variation and a reason; note is optional', () => {
  expect(adjustmentSchema.safeParse({ product_id: uuid, delta: 5, reason: 'Erreur de comptage', requestKey: 'adjust-key-0001' }).success).toBe(true);
  expect(adjustmentSchema.safeParse({ product_id: uuid, delta: -2, reason: 'Casse', note: 'Carton tombé', requestKey: 'adjust-key-0001' }).success).toBe(true);
  expect(adjustmentSchema.safeParse({ product_id: uuid, delta: 1.5, reason: 'Casse', requestKey: 'adjust-key-0001' }).success).toBe(false);
  expect(adjustmentSchema.safeParse({ product_id: uuid, delta: 0, reason: 'Casse', requestKey: 'adjust-key-0001' }).success).toBe(false);
  expect(adjustmentSchema.safeParse({ product_id: uuid, delta: 3, reason: '', requestKey: 'adjust-key-0001' }).success).toBe(false);
});

test('receipt progress is per line, never summing kg with cartons', () => {
  expect(receiptProgress([{ ordered_quantity: 12.5, received_quantity: 12.5 }, { ordered_quantity: 3, received_quantity: 0 }]))
    .toEqual({ percent: 50, completeLines: 1, lines: 2 });
  expect(receiptProgress([{ ordered_quantity: 2.75, received_quantity: 2.75 }])).toEqual({ percent: 100, completeLines: 1, lines: 1 });
});

// ─── Échéances ───────────────────────────────────────────────────────────────

const ordered = (outstanding: number, payment_due_date: string | null) => ({ status: 'ordered' as const, total: 100, outstanding, payment_due_date });

test('due date state: overdue, today, upcoming window, paid, no due', () => {
  const today = '2026-10-01';
  expect(dueInfo(ordered(100, '2026-09-27'), today)).toEqual({ state: 'overdue', days: -4 });
  expect(dueLabel(dueInfo(ordered(100, '2026-09-27'), today))).toBe('En retard de 4 jours');
  expect(dueLabel(dueInfo(ordered(100, '2026-09-30'), today))).toBe('En retard de 1 jour');
  expect(dueInfo(ordered(100, '2026-10-01'), today).state).toBe('today');
  expect(dueLabel(dueInfo(ordered(100, '2026-10-08'), today))).toBe('À payer sous 7 jours');
  expect(dueInfo(ordered(100, '2026-10-09'), today).state).toBe('upcoming');
  expect(dueLabel(dueInfo(ordered(100, null), today))).toBe('Pas d\'échéance');
  // Reste 0 = payé, même avec une échéance dépassée.
  expect(dueInfo(ordered(0, '2026-01-01'), today).state).toBe('paid');
});

test('drafts and cancelled purchases are never overdue', () => {
  const today = '2026-10-01';
  expect(dueInfo({ status: 'draft', total: 100, outstanding: 0, payment_due_date: '2026-01-01' }, today).state).toBe('not_committed');
  expect(dueInfo({ status: 'cancelled', total: 100, outstanding: 0, payment_due_date: '2026-01-01' }, today).state).toBe('cancelled');
});

test('dashboard due aggregations', () => {
  const today = '2026-10-01';
  const totals = summarizeDues([
    { purchase_id: 'a', outstanding: 100.1, payment_due_date: '2026-09-20' },
    { purchase_id: 'b', outstanding: 50.2, payment_due_date: '2026-10-01' },
    { purchase_id: 'c', outstanding: 25, payment_due_date: '2026-10-08' },
    { purchase_id: 'd', outstanding: 10, payment_due_date: '2026-11-30' },
    { purchase_id: 'e', outstanding: 5, payment_due_date: null },
    { purchase_id: 'f', outstanding: 0, payment_due_date: '2026-09-01' },
  ], today);
  expect(totals).toEqual({
    toPay: 190.3, toPayCount: 5, dueSoon: 75.2, dueSoonCount: 2, overdue: 100.1, overdueCount: 1, noDueCount: 1,
  });
});

test('calendar helpers and payment terms labels', () => {
  expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
  expect(addDays('2026-10-01', -30)).toBe('2026-09-01');
  expect(gestionToday(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01'); // déjà le 1er à Paris
  expect(paymentTermsLabel(0)).toBe('Paiement immédiat');
  expect(paymentTermsLabel(45)).toBe('45 jours');
  expect(paymentTermsLabel(null)).toBe('Non définies');
});

// ─── Coûts ───────────────────────────────────────────────────────────────────

test('a receipt dated today is never sent with a future timestamp (server takes now())', () => {
  expect(receivedAtForDate('2026-10-01', '2026-10-01')).toBeNull();
  expect(receivedAtForDate('2026-10-02', '2026-10-01')).toBeNull();
  const past = receivedAtForDate('2026-09-28', '2026-10-01');
  expect(past).not.toBeNull();
  expect(Date.parse(past!)).toBeLessThan(Date.parse('2026-09-29T00:00:00Z'));
});

test('dates and times are shown in the Gestion time zone, calendar dates unchanged', () => {
  expect(formatDateTime('2026-10-01T09:55:00Z')).toBe('01/10/2026 11:55');
  expect(formatDate('2026-09-30T22:30:00Z')).toBe('01/10/2026'); // déjà le 1er à Paris
  expect(formatDate('2026-09-25')).toBe('25/09/2026');
});

test('indicative margin = price - last purchase cost', () => {
  expect(indicativeMargin(6, 4)).toEqual({ amount: 2, percent: 33.3 });
  expect(indicativeMargin(3, 4)).toEqual({ amount: -1, percent: -33.3 });
  expect(indicativeMargin(0, 4).percent).toBeNull();
});

// ─── Stock : routes et capabilities ──────────────────────────────────────────

test('stock surfaces use the existing inventory capabilities', () => {
  expect(permissionsForAdminPath('/admin/gestion/stocks', 'shop')).toEqual(['inventory.view']);
  expect(gestionApiPermission('/api/admin/gestion/inventory/products', 'GET')).toBe('inventory.view');
  expect(gestionApiPermission('/api/admin/gestion/inventory/products', 'POST')).toBeNull();
  expect(gestionApiPermission('/api/admin/gestion/inventory/adjustments', 'POST')).toBe('inventory.manage');
  expect(gestionApiPermission(`/api/admin/gestion/purchases/${uuid}/due-date`, 'POST')).toBe('purchases.manage');
  expect(gestionApiPermission(`/api/admin/gestion/purchases/${uuid}/due-date`, 'GET')).toBeNull();
});
