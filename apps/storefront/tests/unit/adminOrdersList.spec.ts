import { test, expect } from '@playwright/test';
import { ORDER_LIST, parseOrderList, sanitizeOrderSearch } from '../../src/lib/orders/orderListParams';
import { buildOrdersCsv, ORDER_CSV_HEADER, type ExportOrderRow } from '../../src/lib/orders/ordersCsv';

test('orders list URL: views, filters, legacy sorts and page size', () => {
  const { values, filters, sort } = parseOrderList({ view: 'incidents', status: 'preparing', payment: 'cash', sort: 'date_desc', size: '25', page: '2', q: 'Ntjam' });
  expect(filters).toEqual({ view: 'incidents', status: 'preparing', fulfillment: '', payment: 'cash', dateFrom: '', dateTo: '', search: 'Ntjam' });
  expect(sort).toBe('newest');
  expect(values.pageSize).toBe(25);
  expect(values.page).toBe(2);
  expect(parseOrderList({ view: 'nope', sort: 'nope' }).filters.view).toBe('');
  expect(parseOrderList({}).sort).toBe('priority');
});

test('orders list hrefs keep state, drop the default sort and reset the page', () => {
  const { values } = parseOrderList({ status: 'new', sort: 'priority', page: '3' });
  expect(ORDER_LIST.href('/admin', values, { view: 'urgent' })).toBe('/admin?view=urgent&status=new');
  const newest = parseOrderList({ sort: 'newest' }).values;
  expect(ORDER_LIST.href('/admin', newest, { page: 2 })).toBe('/admin?sort=newest&page=2');
});

test('search keeps the characters the work queue accepts', () => {
  expect(sanitizeOrderSearch('  #CC4314FE  ')).toBe('#CC4314FE');
  expect(sanitizeOrderSearch("a'b;c(d)")).toBe('abcd');
});

const row = (patch: Partial<ExportOrderRow> = {}): ExportOrderRow => ({
  id: 'cc4314fe-0000-4000-8000-000000000000', created_at: '2026-09-14T17:04:00Z', full_name: 'Benjamin', email: 'b@example.test',
  fulfillment_type: 'delivery', shipping_address: { postal_code: '28069', city: 'Trecate', country: 'IT' }, shipping_details: { carrierName: 'poste_italiane' },
  subtotal: 20, shipping_cost: 7.11, total: 27.11, status: 'preparing', payment_method: 'stripe', payment_status: 'paid',
  tracking_carrier: null, tracking_code: null, order_items: [{ quantity: 4 }, { quantity: 3 }], ...patch,
});

test('CSV: BOM, French separators, labels and one line per order', () => {
  const csv = buildOrdersCsv([row()]);
  expect(csv.startsWith('﻿')).toBe(true);
  const [header, line] = csv.slice(1).trim().split('\r\n');
  expect(header).toBe(ORDER_CSV_HEADER.map((h) => `"${h}"`).join(';'));
  const cells = line!.split(';');
  expect(cells[0]).toBe('"#CC4314FE"');
  expect(cells[1]).toBe('"14/09/2026 19:04"');
  expect(cells[8]).toBe('"7"');
  expect(cells[11]).toBe('"27,11"');
  expect(cells[12]).toBe('"En préparation"');
  expect(cells[13]).toBe('"Carte bancaire"');
  expect(cells[14]).toBe('"Payé"');
});

test('CSV neutralises spreadsheet formulas and quotes', () => {
  const csv = buildOrdersCsv([row({ full_name: '=HYPERLINK("x")', email: '+33 6 "pro"' })]);
  expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  expect(csv).toContain(`"'+33 6 ""pro"""`);
});
