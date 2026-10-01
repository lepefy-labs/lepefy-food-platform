import ExcelJS from 'exceljs';
import { addDays, gestionToday, GESTION_TIME_ZONE, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, PURCHASE_STATUS_LABELS, purchasePaymentState, PAYMENT_STATE_LABELS } from '@/lib/gestion/domain';
import type { GestionExportData, GestionExportType, ExportPeriod } from '@/lib/gestion/exportData';

type Row = Record<string, any>;
type Cell = ExcelJS.Cell;
type Sheet = ExcelJS.Worksheet;
const NAVY = 'FF17324D';
const PALE = 'FFE8EFF5';
const LINK = 'FF175EA8';
const MONEY = '#,##0.00';
const QUANTITY = '#,##0.###';
const INTEGER = '#,##0';

export function exportFileName(type: GestionExportType, slug: string, today: string): string {
  const clean = slug.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tenant';
  const part = { full: '', suppliers: 'fournisseurs-', purchases: 'achats-', treasury: 'tresorerie-', stock: 'stock-' }[type];
  return `lepefy-gestion-${part}${clean}-${today}.xlsx`;
}

/** Excel worksheet titles are limited to 31 characters and reject []:*?/\\. */
export function detailSheetName(reference: string, used: Set<string>): string {
  const base = reference.replace(/[\[\]:*?/\\']/g, '-').trim().slice(0, 31) || 'Achat';
  let name = base;
  let suffix = 2;
  while ([...used].some((candidate) => candidate.toLowerCase() === name.toLowerCase())) {
    name = `${base.slice(0, 31 - String(suffix).length - 1)}-${suffix++}`;
  }
  used.add(name);
  return name;
}

export function internalLink(sheetName: string, row: number): string {
  return `#'${sheetName.replace(/'/g, "''")}'!A${row}`;
}

export function lepefyUrl(origin: string, kind: 'supplier' | 'purchase' | 'payment' | 'product', id: string): string {
  const route = {
    supplier: '/admin/gestion/fournisseurs/', purchase: '/admin/gestion/achats/',
    payment: '/admin/gestion/tresorerie/', product: '/admin/catalogue/',
  }[kind];
  return new URL(`${route}${encodeURIComponent(id)}`, `${origin.replace(/\/+$/, '')}/`).toString();
}

function localDate(value: string | null | undefined, withTime = false): Date | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00Z`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: GESTION_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    withTime ? Number(parts.hour) : 12, withTime ? Number(parts.minute) : 0));
}

function dateCell(cell: Cell, value: string | null | undefined, withTime = false): void {
  cell.value = localDate(value, withTime);
  cell.numFmt = withTime ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
}

function numberCell(cell: Cell, value: unknown, format = MONEY, currency?: string): void {
  cell.value = value === null || value === undefined || value === '' ? null : Number(value);
  cell.numFmt = currency ? `${format} "${currency.replace(/[^A-Z]/g, '')}"` : format;
  cell.alignment = { vertical: 'top', horizontal: 'right' };
}

function linkCell(cell: Cell, text: string, href: string): void {
  cell.value = { text, hyperlink: href, tooltip: text };
  cell.font = { color: { argb: LINK }, underline: true };
}

function table(workbook: ExcelJS.Workbook, name: string, columns: { title: string; width: number }[], generatedAt: string): Sheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
  sheet.getCell('A1').value = `Lepefy Gestion | ${name}`;
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: NAVY } };
  sheet.getCell('A2').value = 'Export généré le';
  dateCell(sheet.getCell('B2'), generatedAt, true);
  const head = sheet.getRow(4);
  head.values = columns.map((column) => column.title);
  head.height = 32;
  head.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  columns.forEach((column, index) => { sheet.getColumn(index + 1).width = column.width; });
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: columns.length } };
  sheet.properties.defaultRowHeight = 19;
  return sheet;
}

function add(sheet: Sheet, values: unknown[]): ExcelJS.Row {
  const row = sheet.addRow(values as ExcelJS.CellValue[]);
  row.alignment = { vertical: 'top', wrapText: true };
  if (row.number % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
  return row;
}

function heading(sheet: Sheet, text: string): number {
  const row = sheet.addRow([text]);
  row.font = { bold: true, color: { argb: NAVY }, size: 12 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
  return row.number;
}

function totalsByCurrency(sheet: Sheet, rows: Row[], fields: { label: string; value: (row: Row) => number }[], currency: (row: Row) => string): void {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const code = currency(row) || 'EUR';
    const values = grouped.get(code) ?? fields.map(() => 0);
    fields.forEach((field, index) => { values[index] = Math.round(((values[index] ?? 0) + field.value(row)) * 100) / 100; });
    grouped.set(code, values);
  }
  if (grouped.size === 0) return;
  heading(sheet, 'Totaux par devise');
  for (const [code, values] of grouped) {
    fields.forEach((field, index) => {
      const row = add(sheet, [`${field.label} (${code})`, values[index]]);
      numberCell(row.getCell(2), values[index], MONEY, code);
      row.font = { bold: true };
    });
  }
}

export interface WorkbookOptions {
  type: GestionExportType;
  tenantName: string;
  tenantCurrency: string;
  origin: string;
  period: ExportPeriod;
  generatedAt: Date;
  includeTreasuryInPurchases?: boolean;
}

export async function buildGestionWorkbook(data: GestionExportData, options: WorkbookOptions): Promise<ExcelJS.Workbook> {
  const { type, origin, period } = options;
  const generatedAt = options.generatedAt.toISOString();
  const today = gestionToday(options.generatedAt);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Lepefy Gestion';
  workbook.created = options.generatedAt;
  workbook.modified = options.generatedAt;
  const balances = new Map(data.balances.map((row) => [row.supplier_id, row]));
  const financials = new Map(data.financials.map((row) => [row.purchase_id, row]));
  const suppliersById = new Map(data.suppliers.map((row) => [row.id, row]));
  const paymentsById = new Map(data.payments.map((row) => [row.id, row]));
  const itemsByPurchase = new Map<string, Row[]>();
  const receiptsByPurchase = new Map<string, Row[]>();
  const linesByReceipt = new Map<string, Row[]>();
  const allocationsByPurchase = new Map<string, Row[]>();
  const allocationsByPayment = new Map<string, Row[]>();
  const append = (map: Map<string, Row[]>, key: string, row: Row) => {
    const rows = map.get(key) ?? [];
    rows.push(row);
    map.set(key, rows);
  };
  for (const item of data.items) append(itemsByPurchase, item.purchase_id, item);
  const itemsById = new Map(data.items.map((row) => [row.id, row]));
  for (const receipt of data.detailReceipts) append(receiptsByPurchase, receipt.purchase_id, receipt);
  for (const line of data.receiptItems) append(linesByReceipt, line.receipt_id, line);
  for (const allocation of period.from || period.to ? data.detailAllocations : data.allocations) {
    append(allocationsByPurchase, allocation.purchase_id, allocation);
  }
  for (const allocation of data.allocations) append(allocationsByPayment, allocation.payment_id, allocation);
  const receivedByItem = new Map<string, number>();
  for (const receipt of data.detailReceipts) {
    if (receipt.status !== 'recorded') continue;
    for (const line of linesByReceipt.get(receipt.id) ?? []) {
      receivedByItem.set(line.purchase_item_id, (receivedByItem.get(line.purchase_item_id) ?? 0) + Math.round(Number(line.quantity) * 1000));
    }
  }

  const summary = workbook.addWorksheet('Synthèse');
  summary.columns = [{ width: 36 }, { width: 28 }, { width: 25 }, { width: 25 }];
  summary.getCell('A1').value = 'Lepefy Gestion | Synthèse';
  summary.getCell('A1').font = { size: 18, bold: true, color: { argb: NAVY } };
  summary.getCell('A3').value = 'Tenant'; summary.getCell('B3').value = options.tenantName;
  summary.getCell('A4').value = 'Export généré le'; dateCell(summary.getCell('B4'), generatedAt, true);
  summary.getCell('A5').value = 'Période analysée';
  summary.getCell('B5').value = period.from || period.to ? `${period.from ?? 'début'} au ${period.to ?? 'aujourd\'hui'}` : 'Toutes les dates';
  summary.getCell('A7').value = 'Navigation'; summary.getCell('A7').font = { bold: true, color: { argb: NAVY }, size: 13 };

  const sheets: string[] = [];
  const addNav = (name: string) => sheets.push(name);

  if (type === 'full' || type === 'suppliers') {
    const sheet = table(workbook, 'Fournisseurs', [
      ['Code', 19], ['Fournisseur', 28], ['Raison sociale', 28], ['Contact', 24], ['Téléphone', 20], ['WhatsApp', 20],
      ['Email', 30], ['Pays', 12], ['Devise', 10], ['Conditions de paiement', 22], ['Nombre d\'achats', 16],
      ['Total acheté', 18], ['Payé vérifié', 18], ['Enregistré à vérifier', 22], ['Reste à payer', 18],
      ['Dernier achat', 17], ['Dernier paiement', 17], ['Actif', 10], ['Ouvrir dans Lepefy', 24],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Fournisseurs');
    for (const supplier of data.suppliers) {
      const balance = balances.get(supplier.id) ?? {};
      const row = add(sheet, [supplier.code, supplier.name, supplier.legal_name, supplier.contact_name, supplier.phone,
        supplier.whatsapp_phone, supplier.email, supplier.country, supplier.currency,
        supplier.default_payment_terms_days === null ? '' : `${supplier.default_payment_terms_days} jours`,
        Number(balance.purchase_count ?? 0), null, null, null, null, null, null, supplier.active ? 'Oui' : 'Non']);
      for (const [index, value] of [[12, balance.total_purchased], [13, balance.paid_verified], [14, balance.paid_unverified], [15, balance.outstanding]] as const)
        numberCell(row.getCell(index), value ?? 0, MONEY, supplier.currency);
      dateCell(row.getCell(16), balance.last_purchase_date); dateCell(row.getCell(17), balance.last_payment_date);
      linkCell(row.getCell(19), 'Ouvrir dans Lepefy', lepefyUrl(origin, 'supplier', supplier.id));
    }
    sheet.autoFilter = { from: 'A4', to: `S${Math.max(4, sheet.rowCount)}` };
    totalsByCurrency(sheet, data.suppliers, [
      { label: 'Total acheté', value: (row) => Number(balances.get(row.id)?.total_purchased ?? 0) },
      { label: 'Payé vérifié', value: (row) => Number(balances.get(row.id)?.paid_verified ?? 0) },
      { label: 'Enregistré à vérifier', value: (row) => Number(balances.get(row.id)?.paid_unverified ?? 0) },
      { label: 'Reste à payer', value: (row) => Number(balances.get(row.id)?.outstanding ?? 0) },
    ], (row) => row.currency);
  }

  let purchaseSheet: Sheet | null = null;
  const purchaseRow = new Map<string, number>();
  if (type === 'full' || type === 'purchases') {
    purchaseSheet = table(workbook, 'Achats', [
      ['Référence', 21], ['Fournisseur', 28], ['Date commande', 17], ['Livraison prévue', 18], ['Échéance paiement', 18],
      ['Statut marchandise', 21], ['Statut paiement', 21], ['Sous-total', 17], ['Frais', 16], ['Total', 17],
      ['Payé vérifié', 17], ['À vérifier', 17], ['Reste à payer', 18], ['Quantité commandée', 20],
      ['Quantité reçue', 18], ['Devise', 10], ['Référence fournisseur', 23], ['Notes', 36], ['Ouvrir dans Lepefy', 24],
      ['Unité quantité', 19],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Achats');
    for (const purchase of data.purchases) {
      const fin = financials.get(purchase.id) ?? {};
      const units = Array.from(new Set((itemsByPurchase.get(purchase.id) ?? []).map((item) => item.purchase_unit).filter(Boolean)));
      const quantityUnit = units.length === 1 ? units[0] : units.length > 1 ? 'Mixte : voir détail' : '';
      const paymentState = purchasePaymentState({ status: purchase.status, total: Number(purchase.total),
        paid_verified: Number(fin.paid_verified ?? 0), paid_unverified: Number(fin.paid_unverified ?? 0),
        outstanding: Number(fin.outstanding ?? 0) });
      const row = add(purchaseSheet, [purchase.reference, purchase.suppliers?.name ?? '', null, null, null,
        PURCHASE_STATUS_LABELS[purchase.status as keyof typeof PURCHASE_STATUS_LABELS] ?? purchase.status,
        PAYMENT_STATE_LABELS[paymentState], null, null, null, null, null, null, null, null,
        purchase.currency, purchase.supplier_reference, purchase.notes, null, quantityUnit]);
      purchaseRow.set(purchase.id, row.number);
      dateCell(row.getCell(3), purchase.order_date); dateCell(row.getCell(4), purchase.expected_date); dateCell(row.getCell(5), purchase.payment_due_date);
      for (const [index, value] of [[8, purchase.subtotal], [9, purchase.additional_costs], [10, purchase.total],
        [11, fin.paid_verified], [12, fin.paid_unverified], [13, fin.outstanding]] as const)
        numberCell(row.getCell(index), value ?? 0, MONEY, purchase.currency);
      numberCell(row.getCell(14), units.length <= 1 ? fin.ordered_quantity ?? 0 : null, QUANTITY);
      numberCell(row.getCell(15), units.length <= 1 ? fin.received_quantity ?? 0 : null, QUANTITY);
      linkCell(row.getCell(19), 'Ouvrir dans Lepefy', lepefyUrl(origin, 'purchase', purchase.id));
    }
    purchaseSheet.autoFilter = { from: 'A4', to: `T${Math.max(4, purchaseSheet.rowCount)}` };
    totalsByCurrency(purchaseSheet, data.purchases.filter((row) => !['draft', 'cancelled'].includes(row.status)), [
      { label: 'Total achats', value: (row) => Number(row.total) },
      { label: 'Payé vérifié', value: (row) => Number(financials.get(row.id)?.paid_verified ?? 0) },
      { label: 'À vérifier', value: (row) => Number(financials.get(row.id)?.paid_unverified ?? 0) },
      { label: 'Reste à payer', value: (row) => Number(financials.get(row.id)?.outstanding ?? 0) },
    ], (row) => row.currency);
  }

  if (type === 'full' || type === 'treasury') {
    const sheet = table(workbook, 'Paiements', [
      ['Référence', 20], ['Date', 17], ['Fournisseur', 27], ['Bénéficiaire', 28], ['Type bénéficiaire', 31],
      ['Mode', 18], ['Montant', 18], ['Devise', 10], ['Statut', 18], ['Compte payeur', 22],
      ['Référence externe', 23], ['Achats affectés', 36], ['Montant affecté', 20], ['Non affecté', 18],
      ['Vérifié par', 24], ['Date vérification', 21], ['Notes', 35], ['Ouvrir dans Lepefy', 24],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Paiements');
    for (const payment of data.payments) {
      const allocations = (allocationsByPayment.get(payment.id) ?? []).filter((row) => !row.reversed_at);
      const allocated = allocations.reduce((sum, row) => sum + Number(row.amount), 0);
      const row = add(sheet, [payment.reference, null, payment.suppliers?.name ?? '', payment.beneficiary_name,
        payment.beneficiary_type === 'third_party' ? 'Tiers - payé sur instruction du fournisseur' : 'Fournisseur',
        PAYMENT_METHOD_LABELS[payment.method as keyof typeof PAYMENT_METHOD_LABELS] ?? payment.method,
        null, payment.currency, PAYMENT_STATUS_LABELS[payment.status as keyof typeof PAYMENT_STATUS_LABELS] ?? payment.status,
        payment.payer_account, payment.external_reference,
        allocations.map((allocation) => `${allocation.supplier_purchases?.reference ?? ''}: ${Number(allocation.amount).toFixed(2)} ${payment.currency}`).join('\n'),
        null, null, data.names[payment.verified_by_admin_id] ?? '', null, payment.notes]);
      dateCell(row.getCell(2), payment.payment_date);
      numberCell(row.getCell(7), payment.amount, MONEY, payment.currency);
      numberCell(row.getCell(13), allocated, MONEY, payment.currency);
      numberCell(row.getCell(14), payment.status === 'voided' ? 0 : Number(payment.amount) - allocated, MONEY, payment.currency);
      dateCell(row.getCell(16), payment.verified_at, true);
      linkCell(row.getCell(18), 'Ouvrir dans Lepefy', lepefyUrl(origin, 'payment', payment.id));
    }
    sheet.autoFilter = { from: 'A4', to: `R${Math.max(4, sheet.rowCount)}` };
    totalsByCurrency(sheet, data.payments, [
      { label: 'Total enregistré', value: (row) => row.status === 'recorded' ? Number(row.amount) : 0 },
      { label: 'Total vérifié', value: (row) => row.status === 'verified' ? Number(row.amount) : 0 },
      { label: 'Total annulé', value: (row) => row.status === 'voided' ? Number(row.amount) : 0 },
    ], (row) => row.currency);
    const allocationsSheet = table(workbook, 'Affectations', [
      ['Paiement', 21], ['Achat', 21], ['Montant', 19], ['Devise', 11], ['État', 16], ['Ouvrir le paiement', 23],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Affectations');
    for (const allocation of data.allocations) {
      const payment = paymentsById.get(allocation.payment_id);
      if (!payment) continue;
      const row = add(allocationsSheet, [payment.reference, allocation.supplier_purchases?.reference ?? '', null,
        payment.currency, allocation.reversed_at ? 'Retirée' : 'Active']);
      numberCell(row.getCell(3), allocation.amount, MONEY, payment.currency);
      linkCell(row.getCell(6), 'Ouvrir dans Lepefy', lepefyUrl(origin, 'payment', payment.id));
    }
    allocationsSheet.autoFilter = { from: 'A4', to: `F${Math.max(4, allocationsSheet.rowCount)}` };
  }

  if (type === 'full' || type === 'purchases') {
    const sheet = table(workbook, 'Réceptions', [
      ['Référence', 21], ['Date', 21], ['Achat', 21], ['Fournisseur', 28], ['Produit', 30],
      ['Quantité', 16], ['Unité', 14], ['Impact stock', 18], ['Statut', 17], ['Auteur', 22], ['Notes', 35],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Réceptions');
    for (const receipt of data.receipts) {
      const lines = linesByReceipt.get(receipt.id) ?? [];
      for (const line of lines.length ? lines : [null]) {
        const item = line ? itemsById.get(line.purchase_item_id) : null;
        const row = add(sheet, [receipt.reference, null, receipt.supplier_purchases?.reference ?? '',
          receipt.supplier_purchases?.suppliers?.name ?? '', item?.products?.name ?? item?.description ?? '',
          null, line?.purchase_unit ?? '', null, receipt.status === 'reversed' ? 'Annulée' : 'Enregistrée',
          data.names[receipt.created_by_admin_id] ?? '', receipt.notes]);
        dateCell(row.getCell(2), receipt.received_at, true);
        numberCell(row.getCell(6), line?.quantity ?? null, QUANTITY);
        numberCell(row.getCell(8), line ? (receipt.status === 'reversed' ? 0 : line.stock_units) : null, INTEGER);
      }
    }
    sheet.autoFilter = { from: 'A4', to: `K${Math.max(4, sheet.rowCount)}` };
  }

  if (type === 'full' || type === 'stock') {
    const sheet = table(workbook, 'Stock', [
      ['Produit', 32], ['Stock actuel', 16], ['Dernier coût d\'achat', 22], ['Devise', 11],
      ['Date dernier coût', 20], ['Dernier fournisseur', 28], ['Dernière réception', 20],
      ['Dernier mouvement', 20], ['État coût', 18], ['Ouvrir dans Lepefy', 24],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Stock');
    const costByProduct = new Map(data.costs.map((row) => [row.product_id, row]));
    for (const product of data.stock) {
      const supplier = suppliersById.get(costByProduct.get(product.product_id)?.source_supplier_id);
      const row = add(sheet, [product.name, null, null, product.cost_currency,
        null, supplier?.name ?? '', null, null, product.current_purchase_cost == null ? 'Sans coût connu' : 'Coût connu']);
      numberCell(row.getCell(2), product.stock, INTEGER);
      numberCell(row.getCell(3), product.current_purchase_cost, MONEY, product.cost_currency ?? undefined);
      dateCell(row.getCell(5), product.cost_effective_at, true);
      dateCell(row.getCell(7), product.last_receipt_at, true);
      dateCell(row.getCell(8), product.last_movement_at, true);
      linkCell(row.getCell(10), 'Ouvrir dans Lepefy', lepefyUrl(origin, 'product', product.product_id));
    }
    sheet.autoFilter = { from: 'A4', to: `J${Math.max(4, sheet.rowCount)}` };
    const movementSheet = table(workbook, 'Mouvements stock', [
      ['Date', 21], ['Produit', 31], ['Type', 21], ['Quantité source', 20], ['Unité source', 17],
      ['Conversion', 17], ['Variation stock', 20], ['Stock après', 17], ['Référence source', 23], ['Motif', 28], ['Auteur', 23],
    ].map(([title, width]) => ({ title: String(title), width: Number(width) })), generatedAt);
    addNav('Mouvements stock');
    const stockById = new Map(data.stock.map((row) => [row.product_id, row]));
    for (const movement of data.movements) {
      const row = add(movementSheet, [null, stockById.get(movement.product_id)?.name ?? 'Produit', movement.movement_type,
        null, movement.source_unit, null, null, null, movement.source_reference, movement.reason ?? movement.note,
        data.names[movement.created_by_admin_id] ?? '']);
      dateCell(row.getCell(1), movement.created_at, true);
      numberCell(row.getCell(4), movement.source_quantity, QUANTITY);
      numberCell(row.getCell(6), movement.conversion_factor, QUANTITY);
      numberCell(row.getCell(7), movement.quantity_delta, INTEGER);
      numberCell(row.getCell(8), movement.stock_after, INTEGER);
    }
    movementSheet.autoFilter = { from: 'A4', to: `K${Math.max(4, movementSheet.rowCount)}` };
  }

  // Every purchase reference links to its own detail sheet up to 100 purchases.
  // Beyond that, one details sheet holds anchored sections, avoiding thousands of tabs.
  if (purchaseSheet) {
    const compact = data.purchases.length > 100;
    const used = new Set(workbook.worksheets.map((sheet) => sheet.name));
    const shared = compact ? workbook.addWorksheet('Détails achats') : null;
    if (shared) {
      shared.columns = [{ width: 32 }, { width: 28 }, { width: 24 }, { width: 21 }, { width: 21 }, { width: 23 }, { width: 24 }, { width: 24 }, { width: 24 }];
      shared.views = [{ state: 'frozen', ySplit: 1 }];
      addNav('Détails achats');
    }
    for (const purchase of data.purchases) {
      const sheet = shared ?? workbook.addWorksheet(detailSheetName(purchase.reference, used));
      if (!shared) sheet.columns = [{ width: 32 }, { width: 28 }, { width: 24 }, { width: 21 }, { width: 21 }, { width: 23 }, { width: 24 }, { width: 24 }, { width: 24 }];
      const first = sheet.rowCount + 1;
      const title = sheet.addRow([`Achat ${purchase.reference}`]);
      title.font = { bold: true, size: 16, color: { argb: NAVY } };
      linkCell(sheet.addRow(['← Retour aux achats']).getCell(1), '← Retour aux achats', internalLink('Achats', purchaseRow.get(purchase.id) ?? 4));
      const fin = financials.get(purchase.id) ?? {};
      const meta: [string, unknown, 'date' | 'money' | 'text'][] = [
        ['Fournisseur', purchase.suppliers?.name ?? '', 'text'], ['Date commande', purchase.order_date, 'date'],
        ['Livraison prévue', purchase.expected_date, 'date'], ['Échéance', purchase.payment_due_date, 'date'],
        ['Statut', PURCHASE_STATUS_LABELS[purchase.status as keyof typeof PURCHASE_STATUS_LABELS] ?? purchase.status, 'text'],
        ['Total', purchase.total, 'money'], ['Payé vérifié', fin.paid_verified ?? 0, 'money'],
        ['À vérifier', fin.paid_unverified ?? 0, 'money'], ['Reste à payer', fin.outstanding ?? 0, 'money'],
        ['Référence fournisseur', purchase.supplier_reference ?? '', 'text'], ['Notes', purchase.notes ?? '', 'text'],
      ];
      for (const [label, value, format] of meta) {
        const row = add(sheet, [label, null]);
        row.getCell(1).font = { bold: true };
        if (format === 'date') dateCell(row.getCell(2), value as string | null);
        else if (format === 'money') numberCell(row.getCell(2), value, MONEY, purchase.currency);
        else row.getCell(2).value = String(value);
      }
      linkCell(add(sheet, ['Ouvrir dans Lepefy']).getCell(2), 'Ouvrir dans Lepefy', lepefyUrl(origin, 'purchase', purchase.id));
      heading(sheet, 'Articles');
      add(sheet, ['Produit', 'Description', 'Quantité commandée', 'Unité', 'Conversion stock', 'Coût unité achat', 'Total ligne', 'Quantité reçue', 'Reste à recevoir']);
      for (const item of itemsByPurchase.get(purchase.id) ?? []) {
        const received = (receivedByItem.get(item.id) ?? 0) / 1000;
        const row = add(sheet, [item.products?.name ?? '', item.description, null, item.purchase_unit, null, null, null, null, null]);
        for (const [index, value] of [[3, item.ordered_quantity], [5, item.stock_units_per_purchase_unit],
          [8, received], [9, Math.max(0, Number(item.ordered_quantity) - received)]] as const) numberCell(row.getCell(index), value, QUANTITY);
        numberCell(row.getCell(6), item.unit_cost, MONEY, purchase.currency);
        numberCell(row.getCell(7), item.line_total, MONEY, purchase.currency);
      }
      heading(sheet, 'Réceptions');
      add(sheet, ['Référence', 'Date', 'Produit / ligne', 'Quantité reçue', 'Unité', 'Impact stock', 'Statut', 'Auteur', 'Notes']);
      for (const receipt of receiptsByPurchase.get(purchase.id) ?? []) {
        for (const line of linesByReceipt.get(receipt.id) ?? []) {
          const item = itemsById.get(line.purchase_item_id);
          const row = add(sheet, [receipt.reference, null, item?.products?.name ?? item?.description ?? '', null,
            line.purchase_unit, null, receipt.status === 'reversed' ? 'Annulée' : 'Enregistrée',
            data.names[receipt.created_by_admin_id] ?? '', receipt.notes]);
          dateCell(row.getCell(2), receipt.received_at, true);
          numberCell(row.getCell(4), line.quantity, QUANTITY);
          numberCell(row.getCell(6), receipt.status === 'reversed' ? 0 : line.stock_units, INTEGER);
        }
      }
      if (type === 'full' || options.includeTreasuryInPurchases) {
        heading(sheet, 'Paiements');
        add(sheet, ['Référence', 'Date', 'Montant alloué', 'Montant paiement', 'Mode', 'Statut', 'Bénéficiaire', 'Type bénéficiaire', 'Référence externe']);
        for (const allocation of allocationsByPurchase.get(purchase.id) ?? []) {
          const payment = paymentsById.get(allocation.payment_id) ?? allocation.supplier_payments;
          if (!payment) continue;
          const row = add(sheet, [payment.reference, null, null, null, payment.method, payment.status,
            payment.beneficiary_name, payment.beneficiary_type === 'third_party' ? 'Tiers - payé sur instruction du fournisseur' : 'Fournisseur',
            payment.external_reference]);
          dateCell(row.getCell(2), payment.payment_date);
          numberCell(row.getCell(3), allocation.amount, MONEY, payment.currency);
          numberCell(row.getCell(4), payment.amount, MONEY, payment.currency);
        }
        heading(sheet, 'Historique financier');
        add(sheet, ['Paiement', 'État affectation', 'Date vérification']);
        for (const allocation of allocationsByPurchase.get(purchase.id) ?? []) {
          const payment = paymentsById.get(allocation.payment_id) ?? allocation.supplier_payments;
          if (!payment) continue;
          const row = add(sheet, [payment.reference, allocation.reversed_at ? 'Retirée' : 'Active', null]);
          dateCell(row.getCell(3), payment.verified_at, true);
        }
      }
      if (!shared) sheet.views = [{ state: 'frozen', ySplit: 2 }];
      linkCell(purchaseSheet.getCell(`A${purchaseRow.get(purchase.id)}`), purchase.reference, internalLink(sheet.name, first));
      if (shared) sheet.addRow([]);
    }
  }

  sheets.forEach((name, index) => linkCell(summary.getCell(`A${8 + index}`), name, internalLink(name, 1)));
  if (type === 'full') {
    let row = 10 + sheets.length;
    summary.getCell(`A${row}`).value = 'Situation actuelle'; summary.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: NAVY } };
    summary.getCell(`A${++row}`).value = 'Nombre de fournisseurs actifs'; summary.getCell(`B${row}`).value = data.suppliers.filter((supplier) => supplier.active).length;
    const currencyCodes = Array.from(new Set([options.tenantCurrency, ...data.suppliers.map((supplier) => supplier.currency),
      ...data.purchases.map((purchase) => purchase.currency), ...data.payments.map((payment) => payment.currency),
      ...data.openDues.map((due) => due.currency)].filter(Boolean))).sort();
    for (const code of currencyCodes) {
      const dues = data.openDues.filter((due) => due.currency === code);
      const dueTotals = {
        toPay: dues.reduce((sum, due) => sum + Number(due.outstanding), 0),
        overdue: dues.filter((due) => due.payment_due_date && due.payment_due_date < today).reduce((sum, due) => sum + Number(due.outstanding), 0),
        soon: dues.filter((due) => due.payment_due_date && due.payment_due_date >= today && due.payment_due_date <= addDays(today, 7)).reduce((sum, due) => sum + Number(due.outstanding), 0),
      };
      for (const [label, value] of [['Total à payer', dueTotals.toPay], ['Total en retard', dueTotals.overdue], ['À payer sous 7 jours', dueTotals.soon]] as const) {
        summary.getCell(`A${++row}`).value = `${label} (${code})`; numberCell(summary.getCell(`B${row}`), value, MONEY, code);
      }
    }
    for (const code of currencyCodes) {
      const selected = data.payments.filter((payment) => payment.currency === code);
      for (const [label, status] of [['Paiements enregistrés à vérifier', 'recorded'], ['Total payé vérifié sur la période', 'verified']] as const) {
        summary.getCell(`A${++row}`).value = `${label} (${code})`;
        numberCell(summary.getCell(`B${row}`), selected.filter((payment) => payment.status === status).reduce((sum, payment) => sum + Number(payment.amount), 0), MONEY, code);
      }
    }
  }
  return workbook;
}
