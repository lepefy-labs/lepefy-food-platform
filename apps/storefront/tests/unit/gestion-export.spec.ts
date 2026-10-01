import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { buildGestionWorkbook, detailSheetName, exportFileName, internalLink, lepefyUrl } from '../../src/lib/gestion/exportWorkbook';
import type { GestionExportData } from '../../src/lib/gestion/exportData';
import { gestionMidnightUtc, parseExportPeriod } from '../../src/lib/gestion/exportPeriod';

const supplierId = '11111111-1111-1111-1111-111111111111';
const purchaseId = '22222222-2222-2222-2222-222222222222';
const paymentId = '33333333-3333-3333-3333-333333333333';
const receiptId = '44444444-4444-4444-4444-444444444444';
const productId = '55555555-5555-5555-5555-555555555555';
const itemId = '66666666-6666-6666-6666-666666666666';

function fixture(): GestionExportData {
  return {
    suppliers: [{ id: supplierId, code: 'FOU-001', name: 'Test supplier', legal_name: 'Test SA', active: true, currency: 'EUR', default_payment_terms_days: 30 }],
    balances: [{ supplier_id: supplierId, total_purchased: 125, paid_verified: 25, paid_unverified: 10, outstanding: 100,
      purchase_count: 1, last_purchase_date: '2026-09-20', last_payment_date: '2026-09-21' }],
    purchases: [{ id: purchaseId, reference: 'ACH-2026-000123', supplier_id: supplierId, suppliers: { name: 'Test supplier' },
      order_date: '2026-09-20', expected_date: '2026-09-25', payment_due_date: '2026-09-30', status: 'ordered',
      subtotal: 125, additional_costs: 0, total: 125, currency: 'EUR', supplier_reference: 'EXT-1', notes: 'Test' }],
    financials: [{ purchase_id: purchaseId, paid_verified: 25, paid_unverified: 10, outstanding: 100,
      ordered_quantity: 12.5, received_quantity: 2.5 }],
    openDues: [{ purchase_id: purchaseId, currency: 'EUR', outstanding: 100, payment_due_date: '2026-09-30', status: 'ordered' }],
    items: [{ id: itemId, purchase_id: purchaseId, product_id: productId, products: { name: 'Farine' },
      description: 'Sac de farine', ordered_quantity: 12.5, purchase_unit: 'kg', stock_units_per_purchase_unit: 2,
      unit_cost: 10, line_total: 125 }],
    receipts: [{ id: receiptId, reference: 'REC-2026-000001', purchase_id: purchaseId, received_at: '2026-09-22T09:15:00Z',
      status: 'recorded', notes: 'Livraison', supplier_purchases: { reference: 'ACH-2026-000123', suppliers: { name: 'Test supplier' } } }],
    detailReceipts: [{ id: receiptId, reference: 'REC-2026-000001', purchase_id: purchaseId, received_at: '2026-09-22T09:15:00Z',
      status: 'recorded', notes: 'Livraison', supplier_purchases: { reference: 'ACH-2026-000123', suppliers: { name: 'Test supplier' } } }],
    receiptItems: [{ receipt_id: receiptId, purchase_item_id: itemId, quantity: 2.5, purchase_unit: 'kg', stock_units: 5 }],
    payments: [{ id: paymentId, reference: 'PAY-2026-000001', supplier_id: supplierId, suppliers: { name: 'Test supplier' },
      payment_date: '2026-09-21', amount: 25, currency: 'EUR', status: 'verified', method: 'bank_transfer',
      beneficiary_type: 'third_party', beneficiary_name: 'Mandataire', external_reference: 'BANK-1',
      verified_at: '2026-09-21T12:00:00Z', verified_by_admin_id: 'admin-1' }],
    allocations: [{ payment_id: paymentId, purchase_id: purchaseId, amount: 25, reversed_at: null,
      supplier_purchases: { reference: 'ACH-2026-000123' } }],
    detailAllocations: [{ payment_id: paymentId, purchase_id: purchaseId, amount: 25, reversed_at: null,
      supplier_payments: { id: paymentId, reference: 'PAY-2026-000001', payment_date: '2026-09-21', amount: 25,
        currency: 'EUR', status: 'verified', method: 'bank_transfer', beneficiary_type: 'third_party', beneficiary_name: 'Mandataire' } }],
    stock: [{ product_id: productId, name: 'Farine', stock: 35, current_purchase_cost: 5, cost_currency: 'EUR',
      cost_effective_at: '2026-09-22T09:15:00Z', last_receipt_at: '2026-09-22T09:15:00Z', last_movement_at: '2026-09-22T09:15:00Z' }],
    costs: [{ product_id: productId, source_supplier_id: supplierId }],
    movements: [{ product_id: productId, created_at: '2026-09-22T09:15:00Z', movement_type: 'supplier_receipt',
      source_quantity: 2.5, source_unit: 'kg', conversion_factor: 2, quantity_delta: 5, stock_after: 35,
      source_reference: 'REC-2026-000001' }],
    names: { 'admin-1': 'Test Admin' },
  };
}

const options = {
  type: 'full' as const, tenantName: 'lepefy-test', tenantCurrency: 'EUR', origin: 'https://test.example.org',
  period: { from: '2026-09-01', to: '2026-09-30' }, generatedAt: new Date('2026-10-01T13:00:00Z'),
};

test('real Gestion workbook opens with navigable purchase, numeric cells and third-party payment', async () => {
  const workbook = await buildGestionWorkbook(fixture(), options);
  const bytes = await workbook.xlsx.writeBuffer();
  expect(bytes.byteLength).toBeGreaterThan(5_000);
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(bytes);
  for (const name of ['Synthèse', 'Fournisseurs', 'Achats', 'Paiements', 'Affectations', 'Réceptions', 'Stock', 'Mouvements stock', 'ACH-2026-000123']) {
    expect(opened.getWorksheet(name), name).toBeTruthy();
  }
  const purchases = opened.getWorksheet('Achats')!;
  expect(purchases.getCell('A5').value).toEqual(expect.objectContaining({ text: 'ACH-2026-000123', hyperlink: internalLink('ACH-2026-000123', 1) }));
  expect(purchases.getCell('J5').value).toBe(125);
  expect(purchases.getCell('J5').numFmt).toContain('EUR');
  expect(purchases.getCell('E5').value).toBeInstanceOf(Date);
  expect(purchases.getCell('N5').value).toBe(12.5);
  expect(purchases.getCell('S5').value).toEqual(expect.objectContaining({ hyperlink: `https://test.example.org/admin/gestion/achats/${purchaseId}` }));
  const detail = opened.getWorksheet('ACH-2026-000123')!;
  expect(detail.getCell('A2').value).toEqual(expect.objectContaining({ hyperlink: internalLink('Achats', 5) }));
  const allText = detail.getSheetValues().flatMap((row) => Array.isArray(row) ? row : []).map((value) =>
    typeof value === 'string' ? value : typeof value === 'object' && value && 'text' in value ? value.text : '').join(' ');
  for (const word of ['Articles', 'Réceptions', 'Paiements', 'Historique financier', 'Farine', 'REC-2026-000001', 'PAY-2026-000001']) {
    expect(allText).toContain(word);
  }
  expect(opened.getWorksheet('Paiements')!.getCell('E5').value).toBe('Tiers - payé sur instruction du fournisseur');
  expect(opened.getWorksheet('Stock')!.getCell('B5').value).toBe(35);
  expect(opened.getWorksheet('Stock')!.getCell('C5').value).toBe(5);
  expect(opened.getWorksheet('Synthèse')!.getCell('B4').value).toBeInstanceOf(Date);
  const summary = opened.getWorksheet('Synthèse')!;
  const dueRow = summary.getColumn(1).values.findIndex((value) => value === 'Total en retard (EUR)');
  const paidRow = summary.getColumn(1).values.findIndex((value) => value === 'Total payé vérifié sur la période (EUR)');
  expect(summary.getCell(`B${dueRow}`).value).toBe(100);
  expect(summary.getCell(`B${paidRow}`).value).toBe(25);
  expect(opened.getWorksheet('Fournisseurs')!.getCell('O5').value).toBe(100);
  expect(opened.getWorksheet('Achats')!.views[0]?.state).toBe('frozen');
  expect(opened.getWorksheet('Achats')!.autoFilter).toBeTruthy();
});

test('large export uses one details sheet and every purchase link points to its own section', async () => {
  const data = fixture();
  data.purchases = Array.from({ length: 101 }, (_, index) => ({ ...data.purchases[0], id: `purchase-${index}`, reference: `ACH-2026-${String(index).padStart(6, '0')}` }));
  data.financials = [];
  data.items = [];
  data.receipts = [];
  data.detailReceipts = [];
  data.receiptItems = [];
  data.payments = [];
  data.allocations = [];
  data.detailAllocations = [];
  const workbook = await buildGestionWorkbook(data, { ...options, type: 'purchases', includeTreasuryInPurchases: false });
  expect(workbook.worksheets.filter((sheet) => sheet.name.startsWith('ACH-'))).toHaveLength(0);
  expect(workbook.getWorksheet('Détails achats')).toBeTruthy();
  const first = workbook.getWorksheet('Achats')!.getCell('A5').value as { hyperlink: string };
  const last = workbook.getWorksheet('Achats')!.getCell('A105').value as { hyperlink: string };
  expect(first.hyperlink).toMatch(/^#'Détails achats'!A\d+$/);
  expect(last.hyperlink).toMatch(/^#'Détails achats'!A\d+$/);
  expect(first.hyperlink).not.toBe(last.hyperlink);
  expect(workbook.getWorksheet('Paiements')).toBeUndefined();
});

test('safe names and live links', () => {
  expect(exportFileName('full', 'À Côté/../test', '2026-10-01')).toBe('lepefy-gestion-a-cote-test-2026-10-01.xlsx');
  expect(exportFileName('purchases', 'lepefy-test', '2026-10-01')).toBe('lepefy-gestion-achats-lepefy-test-2026-10-01.xlsx');
  expect(detailSheetName('A/B*C:D?E', new Set())).toBe('A-B-C-D-E');
  expect(lepefyUrl('https://test.example.org', 'supplier', supplierId)).toBe(`https://test.example.org/admin/gestion/fournisseurs/${supplierId}`);
  expect(lepefyUrl('https://test.example.org', 'payment', paymentId)).toBe(`https://test.example.org/admin/gestion/tresorerie/${paymentId}`);
});

test('period validation and Europe/Paris boundaries handle DST', () => {
  expect(parseExportPeriod(new URLSearchParams('from=2026-09-01&to=2026-09-30'))).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  for (const query of ['from=2026-02-30', 'from=2026-10-02&to=2026-10-01', 'tenant_id=other', 'from=', 'from=2026-01-01&from=2026-01-02']) {
    expect(parseExportPeriod(new URLSearchParams(query)), query).toBeNull();
  }
  expect(gestionMidnightUtc('2026-03-29')).toBe('2026-03-28T23:00:00.000Z');
  expect(gestionMidnightUtc('2026-03-30')).toBe('2026-03-29T22:00:00.000Z');
  expect(gestionMidnightUtc('2026-10-25')).toBe('2026-10-24T22:00:00.000Z');
  expect(gestionMidnightUtc('2026-10-26')).toBe('2026-10-25T23:00:00.000Z');
});

test('full summary keeps required zero totals when there are no dues or payments', async () => {
  const data = fixture();
  data.openDues = [];
  data.payments = [];
  data.allocations = [];
  data.detailAllocations = [];
  const workbook = await buildGestionWorkbook(data, options);
  const summary = workbook.getWorksheet('Synthèse')!;
  const labels = summary.getColumn(1).values.filter((value): value is string => typeof value === 'string');
  for (const label of ['Total à payer (EUR)', 'Total en retard (EUR)', 'À payer sous 7 jours (EUR)',
    'Paiements enregistrés à vérifier (EUR)', 'Total payé vérifié sur la période (EUR)']) {
    expect(labels).toContain(label);
  }
});

test('mixed purchase units do not display a misleading aggregate quantity', async () => {
  const data = fixture();
  data.items.push({ ...data.items[0], id: 'other-item', purchase_unit: 'unit', ordered_quantity: 3 });
  const workbook = await buildGestionWorkbook(data, options);
  const purchases = workbook.getWorksheet('Achats')!;
  expect(purchases.getCell('N5').value).toBeNull();
  expect(purchases.getCell('O5').value).toBeNull();
  expect(purchases.getCell('T5').value).toBe('Mixte : voir détail');
});

test('period sheets are filtered while selected purchase detail keeps its full history', async () => {
  const data = fixture();
  data.receipts = [];
  data.payments = [];
  data.allocations = [];
  const workbook = await buildGestionWorkbook(data, options);
  expect(workbook.getWorksheet('Réceptions')!.rowCount).toBeGreaterThanOrEqual(4);
  expect(workbook.getWorksheet('Réceptions')!.getCell('A5').value).toBeNull();
  expect(workbook.getWorksheet('Paiements')!.getCell('A5').value).toBeNull();
  const detail = workbook.getWorksheet('ACH-2026-000123')!;
  const values = detail.getSheetValues().flatMap((row) => Array.isArray(row) ? row : []);
  expect(values).toContain('REC-2026-000001');
  expect(values).toContain('PAY-2026-000001');
});
