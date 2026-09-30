import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import type {
  BeneficiaryType, DocumentEntityType, DocumentType, PaymentMethod, PaymentStatus, PurchaseStatus,
} from '@/lib/gestion/domain';

/**
 * Letture Gestion per le pagine admin (service role, sempre filtrate per
 * tenant_id). Nessun saldo calcolato qui: arrivano dalle view
 * supplier_purchase_financials / supplier_balances (migration 139).
 */

const db = () => createServiceClient();
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  legal_name: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  address: string | null;
  country: string | null;
  currency: string;
  notes: string | null;
  active: boolean;
  created_at: string;
}

export interface SupplierBalance {
  total_purchased: number;
  paid_verified: number;
  paid_unverified: number;
  outstanding: number;
  purchase_count: number;
  last_purchase_date: string | null;
  last_payment_date: string | null;
  unallocated_payments: number;
}

export interface SupplierListItem extends SupplierRow {
  balance: SupplierBalance;
}

const EMPTY_BALANCE: SupplierBalance = {
  total_purchased: 0, paid_verified: 0, paid_unverified: 0, outstanding: 0, purchase_count: 0,
  last_purchase_date: null, last_payment_date: null, unallocated_payments: 0,
};

function toBalance(row: Record<string, unknown> | undefined): SupplierBalance {
  if (!row) return EMPTY_BALANCE;
  return {
    total_purchased: num(row.total_purchased),
    paid_verified: num(row.paid_verified),
    paid_unverified: num(row.paid_unverified),
    outstanding: num(row.outstanding),
    purchase_count: num(row.purchase_count),
    last_purchase_date: (row.last_purchase_date as string | null) ?? null,
    last_payment_date: (row.last_payment_date as string | null) ?? null,
    unallocated_payments: num(row.unallocated_payments),
  };
}

const SUPPLIER_COLUMNS = 'id, code, name, legal_name, contact_name, email, phone, whatsapp_phone, address, country, currency, notes, active, created_at';

/** Caratteri speciali di PostgREST/ILIKE neutralizzati nella ricerca. */
function searchTerm(value: string): string {
  return value.replace(/[%_,()*\\]/g, ' ').trim().slice(0, 80);
}

export async function listSuppliers(tenantId: string, options: { q?: string; status?: 'active' | 'inactive' | 'all' } = {}): Promise<SupplierListItem[]> {
  let query = db().from('suppliers').select(SUPPLIER_COLUMNS).eq('tenant_id', tenantId).order('name').limit(500);
  if (options.status !== 'all') query = query.eq('active', options.status !== 'inactive');
  const term = options.q ? searchTerm(options.q) : '';
  if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,contact_name.ilike.%${term}%,email.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(`suppliers: ${error.message}`);
  const suppliers = (data ?? []) as SupplierRow[];
  if (!suppliers.length) return [];
  const { data: balances, error: balanceError } = await db().from('supplier_balances').select('*')
    .eq('tenant_id', tenantId).in('supplier_id', suppliers.map((supplier) => supplier.id));
  if (balanceError) throw new Error(`supplier_balances: ${balanceError.message}`);
  const byId = new Map((balances ?? []).map((row) => [row.supplier_id as string, row as Record<string, unknown>]));
  return suppliers.map((supplier) => ({ ...supplier, balance: toBalance(byId.get(supplier.id)) }));
}

export async function listActiveSupplierOptions(tenantId: string): Promise<{ id: string; code: string; name: string; currency: string }[]> {
  const { data, error } = await db().from('suppliers').select('id, code, name, currency')
    .eq('tenant_id', tenantId).eq('active', true).order('name').limit(500);
  if (error) throw new Error(`suppliers: ${error.message}`);
  return data ?? [];
}

export async function getSupplier(tenantId: string, supplierId: string): Promise<SupplierListItem | null> {
  const { data, error } = await db().from('suppliers').select(SUPPLIER_COLUMNS)
    .eq('tenant_id', tenantId).eq('id', supplierId).maybeSingle();
  if (error) throw new Error(`supplier: ${error.message}`);
  if (!data) return null;
  const { data: balance } = await db().from('supplier_balances').select('*')
    .eq('tenant_id', tenantId).eq('supplier_id', supplierId).maybeSingle();
  return { ...(data as SupplierRow), balance: toBalance(balance as Record<string, unknown> | undefined) };
}

export interface PurchaseListItem {
  id: string;
  reference: string;
  supplier_id: string;
  supplier_name: string;
  supplier_reference: string | null;
  order_date: string;
  expected_date: string | null;
  currency: string;
  status: PurchaseStatus;
  total: number;
  paid_verified: number;
  paid_unverified: number;
  outstanding: number;
  allocatable: number;
  ordered_quantity: number;
  received_quantity: number;
}

export interface PurchaseFilters {
  status?: PurchaseStatus | 'open' | 'to_receive' | 'unpaid';
  supplierId?: string;
  q?: string;
  limit?: number;
}

export async function listPurchases(tenantId: string, filters: PurchaseFilters = {}): Promise<PurchaseListItem[]> {
  let query = db().from('supplier_purchases')
    .select('id, reference, supplier_id, supplier_reference, order_date, expected_date, currency, status, total, suppliers(name)')
    .eq('tenant_id', tenantId).order('order_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(filters.limit ?? 300);
  if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId);
  if (filters.status === 'open') query = query.in('status', ['draft', 'ordered', 'partially_received']);
  else if (filters.status === 'to_receive') query = query.in('status', ['ordered', 'partially_received']);
  else if (filters.status && filters.status !== 'unpaid') query = query.eq('status', filters.status);
  const term = filters.q ? searchTerm(filters.q) : '';
  if (term) query = query.or(`reference.ilike.%${term}%,supplier_reference.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw new Error(`supplier_purchases: ${error.message}`);
  const purchases = data ?? [];
  if (!purchases.length) return [];
  const { data: financials, error: finError } = await db().from('supplier_purchase_financials').select('*')
    .eq('tenant_id', tenantId).in('purchase_id', purchases.map((purchase) => purchase.id));
  if (finError) throw new Error(`supplier_purchase_financials: ${finError.message}`);
  const byId = new Map((financials ?? []).map((row) => [row.purchase_id as string, row as Record<string, unknown>]));
  const rows = purchases.map((purchase) => {
    const f = byId.get(purchase.id);
    const supplier = purchase.suppliers as unknown as { name: string } | null;
    return {
      id: purchase.id, reference: purchase.reference, supplier_id: purchase.supplier_id,
      supplier_name: supplier?.name ?? '', supplier_reference: purchase.supplier_reference,
      order_date: purchase.order_date, expected_date: purchase.expected_date, currency: purchase.currency,
      status: purchase.status as PurchaseStatus, total: num(purchase.total),
      paid_verified: num(f?.paid_verified), paid_unverified: num(f?.paid_unverified),
      outstanding: num(f?.outstanding), allocatable: num(f?.allocatable),
      ordered_quantity: num(f?.ordered_quantity), received_quantity: num(f?.received_quantity),
    };
  });
  return filters.status === 'unpaid' ? rows.filter((row) => row.outstanding > 0) : rows;
}

export interface PurchaseItemRow {
  id: string;
  product_id: string | null;
  product_name: string | null;
  description: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost: number;
  line_total: number;
}

export interface ReceiptRow {
  id: string;
  reference: string;
  received_at: string;
  notes: string | null;
  status: 'recorded' | 'reversed';
  reversal_reason: string | null;
  reversed_at: string | null;
  created_by: string | null;
  lines: { purchase_item_id: string; description: string; quantity: number }[];
}

export interface AllocationRow {
  id: string;
  amount: number;
  created_at: string;
  reversed_at: string | null;
  reversal_reason: string | null;
  payment: PaymentSummary;
}

export interface PaymentSummary {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  payment_date: string;
  method: PaymentMethod;
  status: PaymentStatus;
  beneficiary_type: BeneficiaryType;
  beneficiary_name: string;
}

export interface PurchaseDetail extends PurchaseListItem {
  subtotal: number;
  additional_costs: number;
  notes: string | null;
  cancel_reason: string | null;
  created_at: string;
  created_by: string | null;
  items: PurchaseItemRow[];
  receipts: ReceiptRow[];
  allocations: AllocationRow[];
}

const PAYMENT_SUMMARY_COLUMNS = 'id, reference, amount, currency, payment_date, method, status, beneficiary_type, beneficiary_name';

function toPaymentSummary(row: Record<string, unknown>): PaymentSummary {
  return {
    id: row.id as string, reference: row.reference as string, amount: num(row.amount), currency: row.currency as string,
    payment_date: row.payment_date as string, method: row.method as PaymentMethod, status: row.status as PaymentStatus,
    beneficiary_type: row.beneficiary_type as BeneficiaryType, beneficiary_name: row.beneficiary_name as string,
  };
}

export async function adminNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (!unique.length) return new Map();
  const { data } = await db().from('admin_users').select('id, email, first_name, last_name, nickname').in('id', unique);
  return new Map((data ?? []).map((admin) => [
    admin.id as string,
    (admin.nickname as string | null) || [admin.first_name, admin.last_name].filter(Boolean).join(' ') || (admin.email as string),
  ]));
}

export async function getPurchaseDetail(tenantId: string, purchaseId: string): Promise<PurchaseDetail | null> {
  const { data: purchase, error } = await db().from('supplier_purchases')
    .select('id, reference, supplier_id, supplier_reference, order_date, expected_date, currency, status, subtotal, additional_costs, total, notes, cancel_reason, created_at, created_by_admin_id, suppliers(name)')
    .eq('tenant_id', tenantId).eq('id', purchaseId).maybeSingle();
  if (error) throw new Error(`supplier_purchase: ${error.message}`);
  if (!purchase) return null;

  const [financialsResult, itemsResult, receiptsResult, allocationsResult] = await Promise.all([
    db().from('supplier_purchase_financials').select('*').eq('tenant_id', tenantId).eq('purchase_id', purchaseId).maybeSingle(),
    db().from('supplier_purchase_items').select('id, product_id, description, ordered_quantity, unit_cost, line_total, position, products(name)')
      .eq('tenant_id', tenantId).eq('purchase_id', purchaseId).order('position'),
    db().from('supplier_receipts').select('id, reference, received_at, notes, status, reversal_reason, reversed_at, created_by_admin_id, supplier_receipt_items(purchase_item_id, quantity)')
      .eq('tenant_id', tenantId).eq('purchase_id', purchaseId).order('received_at', { ascending: false }),
    db().from('supplier_payment_allocations').select(`id, amount, created_at, reversed_at, reversal_reason, supplier_payments(${PAYMENT_SUMMARY_COLUMNS})`)
      .eq('tenant_id', tenantId).eq('purchase_id', purchaseId).order('created_at'),
  ]);
  for (const result of [financialsResult, itemsResult, receiptsResult, allocationsResult]) {
    if (result.error) throw new Error(`purchase detail: ${result.error.message}`);
  }

  const receivedByItem = new Map<string, number>();
  for (const receipt of receiptsResult.data ?? []) {
    if (receipt.status !== 'recorded') continue;
    for (const line of (receipt.supplier_receipt_items ?? []) as { purchase_item_id: string; quantity: number }[]) {
      receivedByItem.set(line.purchase_item_id, (receivedByItem.get(line.purchase_item_id) ?? 0) + line.quantity);
    }
  }
  const items: PurchaseItemRow[] = (itemsResult.data ?? []).map((item) => ({
    id: item.id, product_id: item.product_id,
    product_name: (item.products as unknown as { name: string } | null)?.name ?? null,
    description: item.description, ordered_quantity: item.ordered_quantity,
    received_quantity: receivedByItem.get(item.id) ?? 0, unit_cost: num(item.unit_cost), line_total: num(item.line_total),
  }));
  const descriptionById = new Map(items.map((item) => [item.id, item.description]));
  const names = await adminNames([
    purchase.created_by_admin_id, ...(receiptsResult.data ?? []).map((receipt) => receipt.created_by_admin_id),
  ]);
  const f = (financialsResult.data ?? {}) as Record<string, unknown>;

  return {
    id: purchase.id, reference: purchase.reference, supplier_id: purchase.supplier_id,
    supplier_name: (purchase.suppliers as unknown as { name: string } | null)?.name ?? '',
    supplier_reference: purchase.supplier_reference, order_date: purchase.order_date, expected_date: purchase.expected_date,
    currency: purchase.currency, status: purchase.status as PurchaseStatus, total: num(purchase.total),
    subtotal: num(purchase.subtotal), additional_costs: num(purchase.additional_costs), notes: purchase.notes,
    cancel_reason: purchase.cancel_reason, created_at: purchase.created_at,
    created_by: purchase.created_by_admin_id ? names.get(purchase.created_by_admin_id) ?? null : null,
    paid_verified: num(f.paid_verified), paid_unverified: num(f.paid_unverified), outstanding: num(f.outstanding),
    allocatable: num(f.allocatable), ordered_quantity: num(f.ordered_quantity), received_quantity: num(f.received_quantity),
    items,
    receipts: (receiptsResult.data ?? []).map((receipt) => ({
      id: receipt.id, reference: receipt.reference, received_at: receipt.received_at, notes: receipt.notes,
      status: receipt.status as 'recorded' | 'reversed', reversal_reason: receipt.reversal_reason, reversed_at: receipt.reversed_at,
      created_by: receipt.created_by_admin_id ? names.get(receipt.created_by_admin_id) ?? null : null,
      lines: ((receipt.supplier_receipt_items ?? []) as { purchase_item_id: string; quantity: number }[]).map((line) => ({
        purchase_item_id: line.purchase_item_id, description: descriptionById.get(line.purchase_item_id) ?? '', quantity: line.quantity,
      })),
    })),
    allocations: (allocationsResult.data ?? []).map((allocation) => ({
      id: allocation.id, amount: num(allocation.amount), created_at: allocation.created_at,
      reversed_at: allocation.reversed_at, reversal_reason: allocation.reversal_reason,
      payment: toPaymentSummary(allocation.supplier_payments as unknown as Record<string, unknown>),
    })),
  };
}

export interface PaymentRow extends PaymentSummary {
  supplier_id: string;
  supplier_name: string;
  payer_account: string | null;
  beneficiary_reference: string | null;
  supplier_instruction_note: string | null;
  external_reference: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  allocated: number;
  allocations: { id: string; purchase_id: string; purchase_reference: string; amount: number; reversed_at: string | null }[];
  document_count: number;
}

export interface PaymentFilters {
  paymentId?: string;
  from?: string;
  to?: string;
  supplierId?: string;
  method?: PaymentMethod;
  status?: PaymentStatus;
  beneficiaryType?: BeneficiaryType;
  limit?: number;
}

export async function listPayments(tenantId: string, filters: PaymentFilters = {}): Promise<PaymentRow[]> {
  let query = db().from('supplier_payments')
    .select(`${PAYMENT_SUMMARY_COLUMNS}, supplier_id, payer_account, beneficiary_reference, supplier_instruction_note, external_reference, notes, created_at, created_by_admin_id, verified_by_admin_id, verified_at, voided_at, void_reason, suppliers(name), supplier_payment_allocations(id, purchase_id, amount, reversed_at, supplier_purchases(reference))`)
    .eq('tenant_id', tenantId).order('payment_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(filters.limit ?? 300);
  if (filters.paymentId) query = query.eq('id', filters.paymentId);
  if (filters.from) query = query.gte('payment_date', filters.from);
  if (filters.to) query = query.lte('payment_date', filters.to);
  if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId);
  if (filters.method) query = query.eq('method', filters.method);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.beneficiaryType) query = query.eq('beneficiary_type', filters.beneficiaryType);
  const { data, error } = await query;
  if (error) throw new Error(`supplier_payments: ${error.message}`);
  const payments = data ?? [];
  if (!payments.length) return [];

  const [names, documents] = await Promise.all([
    adminNames(payments.flatMap((payment) => [payment.created_by_admin_id, payment.verified_by_admin_id])),
    db().from('business_documents').select('entity_id').eq('tenant_id', tenantId).eq('entity_type', 'supplier_payment')
      .is('deleted_at', null).in('entity_id', payments.map((payment) => payment.id)),
  ]);
  const documentCount = new Map<string, number>();
  for (const document of documents.data ?? []) documentCount.set(document.entity_id, (documentCount.get(document.entity_id) ?? 0) + 1);

  return payments.map((payment) => {
    const allocations = ((payment.supplier_payment_allocations ?? []) as unknown as {
      id: string; purchase_id: string; amount: number; reversed_at: string | null; supplier_purchases: { reference: string } | null;
    }[]).map((allocation) => ({
      id: allocation.id, purchase_id: allocation.purchase_id, purchase_reference: allocation.supplier_purchases?.reference ?? '',
      amount: num(allocation.amount), reversed_at: allocation.reversed_at,
    }));
    return {
      ...toPaymentSummary(payment as unknown as Record<string, unknown>),
      supplier_id: payment.supplier_id,
      supplier_name: (payment.suppliers as unknown as { name: string } | null)?.name ?? '',
      payer_account: payment.payer_account, beneficiary_reference: payment.beneficiary_reference,
      supplier_instruction_note: payment.supplier_instruction_note, external_reference: payment.external_reference,
      notes: payment.notes, created_at: payment.created_at,
      created_by: payment.created_by_admin_id ? names.get(payment.created_by_admin_id) ?? null : null,
      verified_by: payment.verified_by_admin_id ? names.get(payment.verified_by_admin_id) ?? null : null,
      verified_at: payment.verified_at, voided_at: payment.voided_at, void_reason: payment.void_reason,
      allocated: allocations.filter((allocation) => !allocation.reversed_at).reduce((sum, allocation) => sum + allocation.amount, 0),
      allocations,
      document_count: documentCount.get(payment.id) ?? 0,
    };
  });
}

export interface DocumentRow {
  id: string;
  entity_type: DocumentEntityType;
  entity_id: string;
  document_type: DocumentType;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  note: string | null;
  created_at: string;
}

export async function listDocuments(tenantId: string, entities: { type: DocumentEntityType; ids: string[] }[]): Promise<DocumentRow[]> {
  const results = await Promise.all(entities.filter((entity) => entity.ids.length).map((entity) =>
    db().from('business_documents')
      .select('id, entity_type, entity_id, document_type, file_name, mime_type, size_bytes, note, created_at')
      .eq('tenant_id', tenantId).eq('entity_type', entity.type).in('entity_id', entity.ids).is('deleted_at', null)
      .order('created_at', { ascending: false })));
  return results.flatMap((result) => {
    if (result.error) throw new Error(`business_documents: ${result.error.message}`);
    return (result.data ?? []) as DocumentRow[];
  });
}

export interface AuditRow {
  id: string;
  entity_type: string;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  actor: string | null;
}

export async function listAuditEvents(tenantId: string, entities: { type: string; ids: string[] }[], limit = 50): Promise<AuditRow[]> {
  const results = await Promise.all(entities.filter((entity) => entity.ids.length).map((entity) =>
    db().from('business_audit_events').select('id, entity_type, event_type, metadata, created_at, actor_admin_id')
      .eq('tenant_id', tenantId).eq('entity_type', entity.type).in('entity_id', entity.ids)
      .order('created_at', { ascending: false }).limit(limit)));
  const rows = results.flatMap((result) => {
    if (result.error) throw new Error(`business_audit_events: ${result.error.message}`);
    return result.data ?? [];
  });
  const names = await adminNames(rows.map((row) => row.actor_admin_id));
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit)
    .map((row) => ({
      id: row.id, entity_type: row.entity_type, event_type: row.event_type,
      metadata: (row.metadata ?? {}) as Record<string, unknown>, created_at: row.created_at,
      actor: row.actor_admin_id ? names.get(row.actor_admin_id) ?? null : null,
    }));
}

export interface DashboardData {
  openDebt: number;
  openPurchases: number;
  purchasesWithBalance: number;
  paidVerified30d: number;
  toReceive: number;
  paymentsToVerifyCount: number;
  paymentsToVerifyAmount: number;
  unallocatedPayments: number;
  overdueReceipts: number;
  staleUnverifiedPayments: number;
  recentPayments: PaymentRow[];
  recentPurchases: PurchaseListItem[];
  currency: string;
}

export async function getDashboard(tenantId: string, currency: string): Promise<DashboardData> {
  const today = new Date().toISOString().slice(0, 10);
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const staleBefore = new Date(Date.now() - 7 * 864e5).toISOString();

  const [financials, openPurchases, overdue, verified, toVerify, balances, recentPayments, recentPurchases] = await Promise.all([
    db().from('supplier_purchase_financials').select('outstanding, status').eq('tenant_id', tenantId).neq('status', 'cancelled'),
    db().from('supplier_purchases').select('id, status').eq('tenant_id', tenantId).in('status', ['draft', 'ordered', 'partially_received']),
    db().from('supplier_purchases').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      .in('status', ['ordered', 'partially_received']).lt('expected_date', today),
    db().from('supplier_payments').select('amount').eq('tenant_id', tenantId).eq('status', 'verified').gte('payment_date', since30),
    db().from('supplier_payments').select('amount, created_at').eq('tenant_id', tenantId).eq('status', 'recorded'),
    db().from('supplier_balances').select('unallocated_payments').eq('tenant_id', tenantId),
    listPayments(tenantId, { limit: 5 }),
    listPurchases(tenantId, { limit: 5 }),
  ]);
  for (const result of [financials, openPurchases, overdue, verified, toVerify, balances]) {
    if (result.error) throw new Error(`dashboard: ${result.error.message}`);
  }

  const outstandingRows = financials.data ?? [];
  const recorded = toVerify.data ?? [];
  return {
    openDebt: outstandingRows.reduce((sum, row) => sum + num(row.outstanding), 0),
    purchasesWithBalance: outstandingRows.filter((row) => num(row.outstanding) > 0).length,
    openPurchases: (openPurchases.data ?? []).length,
    toReceive: (openPurchases.data ?? []).filter((row) => row.status !== 'draft').length,
    overdueReceipts: overdue.count ?? 0,
    paidVerified30d: (verified.data ?? []).reduce((sum, row) => sum + num(row.amount), 0),
    paymentsToVerifyCount: recorded.length,
    paymentsToVerifyAmount: recorded.reduce((sum, row) => sum + num(row.amount), 0),
    staleUnverifiedPayments: recorded.filter((row) => row.created_at < staleBefore).length,
    unallocatedPayments: (balances.data ?? []).reduce((sum, row) => sum + num(row.unallocated_payments), 0),
    recentPayments,
    recentPurchases,
    currency,
  };
}

export async function searchProducts(tenantId: string, q: string): Promise<{ id: string; name: string; stock: number; active: boolean }[]> {
  const term = searchTerm(q);
  if (term.length < 2) return [];
  const { data, error } = await db().from('products').select('id, name, stock, active')
    .eq('tenant_id', tenantId).ilike('name', `%${term}%`).order('active', { ascending: false }).order('name').limit(15);
  if (error) throw new Error(`products: ${error.message}`);
  return (data ?? []).map((product) => ({ id: product.id, name: product.name, stock: product.stock, active: product.active }));
}
