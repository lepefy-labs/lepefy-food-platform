import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { gestionMidnightUtc } from '@/lib/gestion/exportPeriod';

export const EXPORT_TYPES = ['full', 'suppliers', 'purchases', 'treasury', 'stock'] as const;
export type GestionExportType = (typeof EXPORT_TYPES)[number];
export interface ExportPeriod { from?: string; to?: string }

/** A synchronous export is intentionally bounded before an XLSX is allocated. */
export const EXPORT_LIMITS = {
  suppliers: 1000, purchases: 1500, purchaseItems: 10000, receipts: 3000,
  payments: 3000, allocations: 10000, stock: 3000, movements: 10000,
} as const;

export class ExportTooLargeError extends Error {
  constructor(public readonly dataset: string) {
    super(`Export trop volumineux (${dataset}). Réduisez la période analysée.`);
  }
}

// The service client is used only here, with an explicit tenant filter on every query.
// PostgREST limits each response to 1,000 rows, so exports page in 500-row blocks.
type Row = Record<string, any>;
type Page = { data: Row[] | null; error: { message: string } | null };
async function allRows(label: string, cap: number, query: (first: number, last: number) => PromiseLike<Page>): Promise<Row[]> {
  const output: Row[] = [];
  for (let first = 0; first <= cap; first += 500) {
    const { data, error } = await query(first, first + 499);
    if (error) throw new Error(`${label}: ${error.message}`);
    output.push(...(data ?? []));
    if (output.length > cap) throw new ExportTooLargeError(label);
    if ((data ?? []).length < 500) break;
  }
  return output;
}

async function rowsForIds(
  label: string, table: string, columns: string, tenantId: string, foreignKey: string, ids: string[], cap: number,
): Promise<Row[]> {
  const client = createServiceClient() as any;
  const output: Row[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    if (!chunk.length) continue;
    const orderColumn = ['supplier_balances', 'supplier_purchase_financials', 'product_costs'].includes(table) ? foreignKey : 'id';
    const rows = await allRows(label, cap - output.length, (first, last) =>
      client.from(table).select(columns).eq('tenant_id', tenantId).in(foreignKey, chunk).order(orderColumn).range(first, last));
    output.push(...rows);
  }
  return output;
}

export interface GestionExportData {
  suppliers: Row[];
  balances: Row[];
  purchases: Row[];
  financials: Row[];
  openDues: Row[];
  items: Row[];
  receipts: Row[];
  detailReceipts: Row[];
  receiptItems: Row[];
  payments: Row[];
  allocations: Row[];
  detailAllocations: Row[];
  stock: Row[];
  costs: Row[];
  movements: Row[];
  names: Record<string, string>;
}

function periodQuery(query: any, column: string, period: ExportPeriod, timestamp = false): any {
  if (period.from) query = query.gte(column, timestamp ? gestionMidnightUtc(period.from) : period.from);
  if (period.to) {
    if (timestamp) {
      const next = new Date(`${period.to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      query = query.lt(column, gestionMidnightUtc(next.toISOString().slice(0, 10)));
    } else query = query.lte(column, period.to);
  }
  return query;
}

export async function loadGestionExport(
  tenantId: string, type: GestionExportType, period: ExportPeriod, includeTreasuryInPurchases = false,
): Promise<GestionExportData> {
  const client = createServiceClient() as any;
  const needsSuppliers = type === 'full' || type === 'suppliers' || type === 'stock';
  const needsPurchases = type === 'full' || type === 'purchases';
  const needsReceipts = needsPurchases;
  const needsPayments = type === 'full' || type === 'treasury' || (type === 'purchases' && includeTreasuryInPurchases);
  const needsStock = type === 'full' || type === 'stock';

  const [suppliers, purchases, receipts, payments, stock, movements, openDues] = await Promise.all([
    needsSuppliers ? allRows('fournisseurs', EXPORT_LIMITS.suppliers, (a, b) => client.from('suppliers')
      .select('id,code,name,legal_name,contact_name,email,phone,whatsapp_phone,country,currency,active,default_payment_terms_days')
      .eq('tenant_id', tenantId).order('name').range(a, b)) : [],
    needsPurchases ? allRows('achats', EXPORT_LIMITS.purchases, (a, b) => periodQuery(client.from('supplier_purchases')
      .select('id,reference,supplier_id,supplier_reference,order_date,expected_date,payment_due_date,currency,status,subtotal,additional_costs,total,notes,suppliers(name)')
      .eq('tenant_id', tenantId), 'order_date', period).order('order_date', { ascending: false }).order('id').range(a, b)) : [],
    needsReceipts ? allRows('réceptions', EXPORT_LIMITS.receipts, (a, b) => periodQuery(client.from('supplier_receipts')
      .select('id,reference,purchase_id,received_at,notes,status,created_by_admin_id,supplier_purchases(reference,suppliers(name))')
      .eq('tenant_id', tenantId), 'received_at', period, true).order('received_at', { ascending: false }).order('id').range(a, b)) : [],
    needsPayments ? allRows('paiements', EXPORT_LIMITS.payments, (a, b) => periodQuery(client.from('supplier_payments')
      .select('id,reference,supplier_id,amount,currency,payment_date,method,status,payer_account,beneficiary_type,beneficiary_name,beneficiary_reference,external_reference,notes,verified_by_admin_id,verified_at,suppliers(name)')
      .eq('tenant_id', tenantId), 'payment_date', period).order('payment_date', { ascending: false }).order('id').range(a, b)) : [],
    needsStock ? allRows('stock', EXPORT_LIMITS.stock, (a, b) => client.from('inventory_product_overview')
      .select('product_id,name,active,stock,last_movement_at,last_receipt_at,current_purchase_cost,cost_currency,cost_effective_at')
      .eq('tenant_id', tenantId).order('name').range(a, b)) : [],
    needsStock ? allRows('mouvements', EXPORT_LIMITS.movements, (a, b) => periodQuery(client.from('inventory_movements')
      .select('id,created_at,product_id,movement_type,quantity_delta,stock_after,source_quantity,source_unit,conversion_factor,source_reference,reason,note,created_by_admin_id')
      .eq('tenant_id', tenantId), 'created_at', period, true).order('created_at', { ascending: false }).order('id').range(a, b)) : [],
    type === 'full' ? allRows('échéances', 5000, (a, b) => client.from('supplier_purchase_financials')
      .select('purchase_id,currency,outstanding,payment_due_date,status').eq('tenant_id', tenantId)
      .gt('outstanding', 0).order('purchase_id').range(a, b)) : [],
  ]);

  const purchaseIds = purchases.map((row) => row.id);
  const filteredPeriod = Boolean(period.from || period.to);
  const [detailReceipts, detailAllocations] = await Promise.all([
    needsPurchases && filteredPeriod ? rowsForIds('réceptions des achats', 'supplier_receipts',
      'id,reference,purchase_id,received_at,notes,status,created_by_admin_id,supplier_purchases(reference,suppliers(name))',
      tenantId, 'purchase_id', purchaseIds, EXPORT_LIMITS.receipts) : receipts.filter((row) => purchaseIds.includes(row.purchase_id)),
    needsPurchases && needsPayments && filteredPeriod ? rowsForIds('affectations des achats', 'supplier_payment_allocations',
      'id,payment_id,purchase_id,amount,reversed_at,supplier_payments(id,reference,payment_date,amount,currency,method,status,beneficiary_name,beneficiary_type,external_reference,verified_at)',
      tenantId, 'purchase_id', purchaseIds, EXPORT_LIMITS.allocations) : [],
  ]);
  const [balances, financials, items, receiptItems, allocations, costs] = await Promise.all([
    needsSuppliers ? rowsForIds('soldes fournisseurs', 'supplier_balances', 'supplier_id,total_purchased,paid_verified,paid_unverified,outstanding,purchase_count,last_purchase_date,last_payment_date', tenantId, 'supplier_id', suppliers.map((row) => row.id), EXPORT_LIMITS.suppliers) : [],
    needsPurchases ? rowsForIds('soldes achats', 'supplier_purchase_financials', 'purchase_id,paid_verified,paid_unverified,outstanding,ordered_quantity,received_quantity', tenantId, 'purchase_id', purchases.map((row) => row.id), EXPORT_LIMITS.purchases) : [],
    needsPurchases ? rowsForIds('articles', 'supplier_purchase_items', 'id,purchase_id,product_id,description,ordered_quantity,purchase_unit,stock_units_per_purchase_unit,unit_cost,line_total,position,products(name)', tenantId, 'purchase_id', Array.from(new Set([...purchaseIds, ...receipts.map((row) => row.purchase_id)])), EXPORT_LIMITS.purchaseItems) : [],
    needsReceipts ? rowsForIds('lignes de réception', 'supplier_receipt_items', 'id,receipt_id,purchase_item_id,quantity,purchase_unit,conversion_factor,stock_units', tenantId, 'receipt_id', Array.from(new Set([...receipts, ...detailReceipts].map((row) => row.id))), EXPORT_LIMITS.purchaseItems) : [],
    needsPayments ? rowsForIds('affectations', 'supplier_payment_allocations', 'id,payment_id,purchase_id,amount,reversed_at,supplier_purchases(reference)', tenantId, 'payment_id', payments.map((row) => row.id), EXPORT_LIMITS.allocations) : [],
    needsStock ? rowsForIds('coûts produits', 'product_costs', 'product_id,source_supplier_id', tenantId, 'product_id', stock.map((row) => row.product_id), EXPORT_LIMITS.stock) : [],
  ]);

  const authorIds = Array.from(new Set([
    ...[...receipts, ...detailReceipts].map((row) => row.created_by_admin_id),
    ...payments.map((row) => row.verified_by_admin_id),
    ...movements.map((row) => row.created_by_admin_id),
  ].filter(Boolean)));
  const admins: Row[] = [];
  // admin_users is platform-scoped rather than tenant-scoped. IDs originate only
  // from tenant-filtered Gestion rows, so a separate batch lookup is safe.
  if (authorIds.length) {
    for (let i = 0; i < authorIds.length; i += 100) {
      const { data, error } = await client.from('admin_users').select('id,first_name,last_name,nickname').in('id', authorIds.slice(i, i + 100));
      if (error) throw new Error(`admin_users: ${error.message}`);
      admins.push(...(data ?? []));
    }
  }
  const names = Object.fromEntries(admins.map((row) => [row.id, row.nickname || [row.first_name, row.last_name].filter(Boolean).join(' ')]));
  return { suppliers, balances, purchases, financials, openDues, items, receipts, detailReceipts, receiptItems,
    payments, allocations, detailAllocations, stock, costs, movements, names };
}
