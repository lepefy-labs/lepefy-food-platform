import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import {
  DUE_SOON_DAYS, addDays, gestionToday, summarizeDues,
  type BeneficiaryType, type DueTotals, type DocumentEntityType, type DocumentType, type MovementType, type PaymentMethod,
  type PaymentStatus, type PurchaseStatus, type PurchaseUnit,
} from '@/lib/gestion/domain';

/**
 * Letture Gestion per le pagine admin (service role, sempre filtrate per
 * tenant_id). Nessun saldo calcolato qui: arrivano dalle view
 * supplier_purchase_financials / supplier_balances / inventory_product_overview.
 */

const db = () => createServiceClient();
const num = (value: unknown) => (value === null || value === undefined ? 0 : Number(value));
const numOrNull = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export const STOCK_PAGE_SIZE = 25;
export const MOVEMENT_PAGE_SIZE = 30;

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
  default_payment_terms_days: number | null;
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

const SUPPLIER_COLUMNS = 'id, code, name, legal_name, contact_name, email, phone, whatsapp_phone, address, country, currency, notes, active, default_payment_terms_days, created_at';

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

export interface SupplierOption { id: string; code: string; name: string; currency: string; default_payment_terms_days: number | null }

export async function listActiveSupplierOptions(tenantId: string): Promise<SupplierOption[]> {
  const { data, error } = await db().from('suppliers').select('id, code, name, currency, default_payment_terms_days')
    .eq('tenant_id', tenantId).eq('active', true).order('name').limit(500);
  if (error) throw new Error(`suppliers: ${error.message}`);
  return (data ?? []) as SupplierOption[];
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
  payment_due_date: string | null;
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

/** Filtres de paiement / échéance (calculés côté serveur sur la vue des soldes). */
export const PAYMENT_FILTERS = ['unpaid', 'due_soon', 'overdue', 'paid', 'no_due'] as const;
export type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

export interface PurchaseFilters {
  status?: PurchaseStatus | 'open' | 'to_receive';
  pay?: PaymentFilter;
  supplierId?: string;
  q?: string;
  limit?: number;
}

/** Identifiants d'achats correspondant à un filtre de paiement (tenant-scoped, côté base). */
async function purchaseIdsForPaymentFilter(tenantId: string, pay: PaymentFilter, today: string): Promise<string[]> {
  let query = db().from('supplier_purchase_financials').select('purchase_id').eq('tenant_id', tenantId).limit(2000);
  if (pay === 'unpaid') query = query.gt('outstanding', 0);
  else if (pay === 'due_soon') query = query.gt('outstanding', 0).gte('payment_due_date', today).lte('payment_due_date', addDays(today, DUE_SOON_DAYS));
  else if (pay === 'overdue') query = query.gt('outstanding', 0).lt('payment_due_date', today);
  else if (pay === 'paid') query = query.eq('outstanding', 0).gt('total', 0).not('status', 'in', '(draft,cancelled)');
  else query = query.is('payment_due_date', null).not('status', 'in', '(draft,cancelled)').gt('outstanding', 0);
  const { data, error } = await query;
  if (error) throw new Error(`supplier_purchase_financials: ${error.message}`);
  return (data ?? []).map((row) => row.purchase_id as string);
}

export async function listPurchases(tenantId: string, filters: PurchaseFilters = {}): Promise<PurchaseListItem[]> {
  let restrictTo: string[] | null = null;
  if (filters.pay) {
    restrictTo = await purchaseIdsForPaymentFilter(tenantId, filters.pay, gestionToday());
    if (!restrictTo.length) return [];
  }
  let query = db().from('supplier_purchases')
    .select('id, reference, supplier_id, supplier_reference, order_date, expected_date, payment_due_date, currency, status, total, suppliers(name)')
    .eq('tenant_id', tenantId).order('order_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(filters.limit ?? 300);
  if (restrictTo) query = query.in('id', restrictTo);
  if (filters.supplierId) query = query.eq('supplier_id', filters.supplierId);
  if (filters.status === 'open') query = query.in('status', ['draft', 'ordered', 'partially_received']);
  else if (filters.status === 'to_receive') query = query.in('status', ['ordered', 'partially_received']);
  else if (filters.status) query = query.eq('status', filters.status);
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
  return purchases.map((purchase) => {
    const f = byId.get(purchase.id);
    const supplier = purchase.suppliers as unknown as { name: string } | null;
    return {
      id: purchase.id, reference: purchase.reference, supplier_id: purchase.supplier_id,
      supplier_name: supplier?.name ?? '', supplier_reference: purchase.supplier_reference,
      order_date: purchase.order_date, expected_date: purchase.expected_date, payment_due_date: purchase.payment_due_date,
      currency: purchase.currency, status: purchase.status as PurchaseStatus, total: num(purchase.total),
      paid_verified: num(f?.paid_verified), paid_unverified: num(f?.paid_unverified),
      outstanding: num(f?.outstanding), allocatable: num(f?.allocatable),
      ordered_quantity: num(f?.ordered_quantity), received_quantity: num(f?.received_quantity),
    };
  });
}

export interface PurchaseItemRow {
  id: string;
  product_id: string | null;
  product_name: string | null;
  description: string;
  ordered_quantity: number;
  received_quantity: number;
  purchase_unit: PurchaseUnit;
  stock_units_per_purchase_unit: number | null;
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
  lines: { purchase_item_id: string; description: string; quantity: number; purchase_unit: PurchaseUnit; stock_units: number | null }[];
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
    .select('id, reference, supplier_id, supplier_reference, order_date, expected_date, payment_due_date, currency, status, subtotal, additional_costs, total, notes, cancel_reason, created_at, created_by_admin_id, suppliers(name)')
    .eq('tenant_id', tenantId).eq('id', purchaseId).maybeSingle();
  if (error) throw new Error(`supplier_purchase: ${error.message}`);
  if (!purchase) return null;

  const [financialsResult, itemsResult, receiptsResult, allocationsResult] = await Promise.all([
    db().from('supplier_purchase_financials').select('*').eq('tenant_id', tenantId).eq('purchase_id', purchaseId).maybeSingle(),
    db().from('supplier_purchase_items').select('id, product_id, description, ordered_quantity, purchase_unit, stock_units_per_purchase_unit, unit_cost, line_total, position, products(name)')
      .eq('tenant_id', tenantId).eq('purchase_id', purchaseId).order('position'),
    db().from('supplier_receipts').select('id, reference, received_at, notes, status, reversal_reason, reversed_at, created_by_admin_id, supplier_receipt_items(purchase_item_id, quantity, purchase_unit, stock_units)')
      .eq('tenant_id', tenantId).eq('purchase_id', purchaseId).order('received_at', { ascending: false }),
    db().from('supplier_payment_allocations').select(`id, amount, created_at, reversed_at, reversal_reason, supplier_payments(${PAYMENT_SUMMARY_COLUMNS})`)
      .eq('tenant_id', tenantId).eq('purchase_id', purchaseId).order('created_at'),
  ]);
  for (const result of [financialsResult, itemsResult, receiptsResult, allocationsResult]) {
    if (result.error) throw new Error(`purchase detail: ${result.error.message}`);
  }

  type ReceiptLine = { purchase_item_id: string; quantity: number; purchase_unit: PurchaseUnit; stock_units: number | null };
  // Somme en millièmes entiers : pas d'erreur flottante sur 5 + 7,5.
  const receivedByItem = new Map<string, number>();
  for (const receipt of receiptsResult.data ?? []) {
    if (receipt.status !== 'recorded') continue;
    for (const line of (receipt.supplier_receipt_items ?? []) as ReceiptLine[]) {
      receivedByItem.set(line.purchase_item_id, (receivedByItem.get(line.purchase_item_id) ?? 0) + Math.round(num(line.quantity) * 1000));
    }
  }
  const items: PurchaseItemRow[] = (itemsResult.data ?? []).map((item) => ({
    id: item.id, product_id: item.product_id,
    product_name: (item.products as unknown as { name: string } | null)?.name ?? null,
    description: item.description, ordered_quantity: num(item.ordered_quantity),
    received_quantity: (receivedByItem.get(item.id) ?? 0) / 1000,
    purchase_unit: (item.purchase_unit ?? 'unit') as PurchaseUnit,
    stock_units_per_purchase_unit: numOrNull(item.stock_units_per_purchase_unit),
    unit_cost: num(item.unit_cost), line_total: num(item.line_total),
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
    payment_due_date: purchase.payment_due_date,
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
      lines: ((receipt.supplier_receipt_items ?? []) as ReceiptLine[]).map((line) => ({
        purchase_item_id: line.purchase_item_id, description: descriptionById.get(line.purchase_item_id) ?? '',
        quantity: num(line.quantity), purchase_unit: (line.purchase_unit ?? 'unit') as PurchaseUnit, stock_units: numOrNull(line.stock_units),
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

// ─── Échéances ───────────────────────────────────────────────────────────────

export interface DueItem {
  purchase_id: string;
  reference: string;
  supplier_name: string;
  payment_due_date: string;
  outstanding: number;
  currency: string;
}

export interface DueSummary extends DueTotals {
  today: string;
  /** Échéances ouvertes, de la plus urgente (retard le plus ancien) à la plus lointaine. */
  items: DueItem[];
}

export async function getDueSummary(tenantId: string, limit = 8): Promise<DueSummary> {
  const today = gestionToday();
  const { data, error } = await db().from('supplier_purchase_financials')
    .select('purchase_id, outstanding, payment_due_date, currency').eq('tenant_id', tenantId).gt('outstanding', 0).limit(5000);
  if (error) throw new Error(`dues: ${error.message}`);
  const rows = (data ?? []).map((row) => ({
    purchase_id: row.purchase_id as string, outstanding: num(row.outstanding),
    payment_due_date: (row.payment_due_date as string | null) ?? null, currency: row.currency as string,
  }));
  const dated = rows.filter((row) => row.payment_due_date).sort((a, b) => a.payment_due_date!.localeCompare(b.payment_due_date!)).slice(0, limit);
  let items: DueItem[] = [];
  if (dated.length) {
    const { data: purchases } = await db().from('supplier_purchases').select('id, reference, suppliers(name)')
      .eq('tenant_id', tenantId).in('id', dated.map((row) => row.purchase_id));
    const byId = new Map((purchases ?? []).map((purchase) => [purchase.id as string, purchase]));
    items = dated.map((row) => {
      const purchase = byId.get(row.purchase_id);
      return {
        purchase_id: row.purchase_id, reference: (purchase?.reference as string) ?? '',
        supplier_name: (purchase?.suppliers as unknown as { name: string } | null)?.name ?? '',
        payment_due_date: row.payment_due_date!, outstanding: row.outstanding, currency: row.currency,
      };
    });
  }
  return { today, ...summarizeDues(rows, today), items };
}

// ─── Tableau de bord ─────────────────────────────────────────────────────────

export interface DashboardData {
  dues: DueSummary;
  openPurchases: number;
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
  const today = gestionToday();
  const since30 = addDays(today, -30);
  const staleBefore = new Date(Date.now() - 7 * 864e5).toISOString();

  const [dues, openPurchases, overdue, verified, toVerify, balances, recentPayments, recentPurchases] = await Promise.all([
    getDueSummary(tenantId),
    db().from('supplier_purchases').select('id, status').eq('tenant_id', tenantId).in('status', ['draft', 'ordered', 'partially_received']),
    db().from('supplier_purchases').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId)
      .in('status', ['ordered', 'partially_received']).lt('expected_date', today),
    db().from('supplier_payments').select('amount').eq('tenant_id', tenantId).eq('status', 'verified').gte('payment_date', since30),
    db().from('supplier_payments').select('amount, created_at').eq('tenant_id', tenantId).eq('status', 'recorded'),
    db().from('supplier_balances').select('unallocated_payments').eq('tenant_id', tenantId),
    listPayments(tenantId, { limit: 5 }),
    listPurchases(tenantId, { limit: 5 }),
  ]);
  for (const result of [openPurchases, overdue, verified, toVerify, balances]) {
    if (result.error) throw new Error(`dashboard: ${result.error.message}`);
  }
  const recorded = toVerify.data ?? [];
  return {
    dues,
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

// ─── Stock ───────────────────────────────────────────────────────────────────

export const STOCK_FILTERS = ['all', 'with_movement', 'no_cost', 'out_of_stock'] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

export interface StockProductRow {
  product_id: string;
  name: string;
  active: boolean;
  stock: number;
  price: number;
  last_movement_at: string | null;
  last_movement_type: MovementType | null;
  last_receipt_at: string | null;
  current_purchase_cost: number | null;
  cost_currency: string | null;
}

export interface StockProductQuery {
  q?: string;
  filter?: StockFilter;
  /** Produits ayant au moins un mouvement de ce type et/ou sur cette période. */
  movementType?: MovementType;
  from?: string;
  to?: string;
  page?: number;
}

async function productIdsWithMovements(tenantId: string, movementType?: MovementType, from?: string, to?: string): Promise<string[]> {
  let query = db().from('inventory_movements').select('product_id').eq('tenant_id', tenantId).not('product_id', 'is', null).limit(20000);
  if (movementType) query = query.eq('movement_type', movementType);
  if (from) query = query.gte('created_at', `${from}T00:00:00`);
  if (to) query = query.lt('created_at', `${addDays(to, 1)}T00:00:00`);
  const { data, error } = await query;
  if (error) throw new Error(`inventory_movements: ${error.message}`);
  return Array.from(new Set((data ?? []).map((row) => row.product_id as string)));
}

/** Produits du catalogue avec stock, derniers mouvements et coût courant (paginé côté serveur). */
export async function listStockProducts(tenantId: string, options: StockProductQuery = {}): Promise<{ rows: StockProductRow[]; total: number; page: number }> {
  const page = Math.max(1, options.page ?? 1);
  let restrictTo: string[] | null = null;
  if (options.movementType || options.from || options.to) {
    restrictTo = await productIdsWithMovements(tenantId, options.movementType, options.from, options.to);
    if (!restrictTo.length) return { rows: [], total: 0, page };
  }
  let query = db().from('inventory_product_overview')
    .select('product_id, name, active, stock, price, last_movement_at, last_movement_type, last_receipt_at, current_purchase_cost, cost_currency', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('active', { ascending: false }).order('name')
    .range((page - 1) * STOCK_PAGE_SIZE, page * STOCK_PAGE_SIZE - 1);
  if (restrictTo) query = query.in('product_id', restrictTo.slice(0, 1000));
  const term = options.q ? searchTerm(options.q) : '';
  if (term) query = query.ilike('name', `%${term}%`);
  if (options.filter === 'with_movement') query = query.not('last_movement_at', 'is', null);
  else if (options.filter === 'no_cost') query = query.is('current_purchase_cost', null);
  else if (options.filter === 'out_of_stock') query = query.lte('stock', 0);
  const { data, error, count } = await query;
  if (error) throw new Error(`inventory_product_overview: ${error.message}`);
  return {
    page,
    total: count ?? 0,
    rows: (data ?? []).map((row) => ({
      product_id: row.product_id as string, name: row.name as string, active: Boolean(row.active),
      stock: num(row.stock), price: num(row.price),
      last_movement_at: (row.last_movement_at as string | null) ?? null,
      last_movement_type: (row.last_movement_type as MovementType | null) ?? null,
      last_receipt_at: (row.last_receipt_at as string | null) ?? null,
      current_purchase_cost: numOrNull(row.current_purchase_cost),
      cost_currency: (row.cost_currency as string | null) ?? null,
    })),
  };
}

export interface MovementRow {
  id: string;
  created_at: string;
  product_id: string | null;
  product_name: string;
  movement_type: MovementType;
  quantity_delta: number;
  stock_after: number | null;
  source_quantity: number | null;
  source_unit: PurchaseUnit | null;
  conversion_factor: number | null;
  source_reference: string | null;
  reason: string | null;
  note: string | null;
  author: string | null;
}

export interface MovementQuery {
  productId?: string;
  movementType?: MovementType;
  from?: string;
  to?: string;
  page?: number;
}

/** Ledger inventory_movements, paginé côté serveur. */
export async function listMovements(tenantId: string, options: MovementQuery = {}): Promise<{ rows: MovementRow[]; total: number; page: number }> {
  const page = Math.max(1, options.page ?? 1);
  let query = db().from('inventory_movements')
    .select('id, created_at, product_id, movement_type, quantity_delta, stock_after, source_quantity, source_unit, conversion_factor, source_reference, reason, note, created_by_admin_id', { count: 'exact' })
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .range((page - 1) * MOVEMENT_PAGE_SIZE, page * MOVEMENT_PAGE_SIZE - 1);
  if (options.productId) query = query.eq('product_id', options.productId);
  if (options.movementType) query = query.eq('movement_type', options.movementType);
  if (options.from) query = query.gte('created_at', `${options.from}T00:00:00`);
  if (options.to) query = query.lt('created_at', `${addDays(options.to, 1)}T00:00:00`);
  const { data, error, count } = await query;
  if (error) throw new Error(`inventory_movements: ${error.message}`);
  const rows = data ?? [];
  const productIds = Array.from(new Set(rows.map((row) => row.product_id).filter(Boolean))) as string[];
  const [names, products] = await Promise.all([
    adminNames(rows.map((row) => row.created_by_admin_id)),
    productIds.length
      ? db().from('products').select('id, name').eq('tenant_id', tenantId).in('id', productIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const productName = new Map((products.data ?? []).map((product) => [product.id as string, product.name as string]));
  return {
    page,
    total: count ?? 0,
    rows: rows.map((row) => ({
      id: row.id, created_at: row.created_at, product_id: row.product_id,
      product_name: row.product_id ? productName.get(row.product_id) ?? 'Produit' : 'Produit supprimé',
      movement_type: row.movement_type as MovementType, quantity_delta: num(row.quantity_delta),
      stock_after: numOrNull(row.stock_after), source_quantity: numOrNull(row.source_quantity),
      source_unit: (row.source_unit as PurchaseUnit | null) ?? null, conversion_factor: numOrNull(row.conversion_factor),
      source_reference: row.source_reference, reason: row.reason, note: row.note,
      author: row.created_by_admin_id ? names.get(row.created_by_admin_id) ?? null : null,
    })),
  };
}

export async function getStockProduct(tenantId: string, productId: string): Promise<{ id: string; name: string; stock: number } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return null;
  const { data } = await db().from('products').select('id, name, stock').eq('tenant_id', tenantId).eq('id', productId).maybeSingle();
  return data ? { id: data.id, name: data.name, stock: data.stock } : null;
}

// ─── Coût d'achat ────────────────────────────────────────────────────────────

export interface ProductCostSummary {
  current_purchase_cost: number;
  currency: string;
  effective_at: string;
  purchase_id: string;
  purchase_reference: string;
  supplier_name: string | null;
  source_history_id: string;
  history: { id: string; received_at: string; cost_per_stock_unit: number; purchase_quantity: number; purchase_unit: PurchaseUnit; purchase_unit_cost: number; conversion_factor: number; status: 'active' | 'reversed' }[];
}

/** Dernier coût d'achat (par unité de stock) et historique récent. Données internes, admin uniquement. */
export async function getProductCost(tenantId: string, productId: string): Promise<ProductCostSummary | null> {
  const [{ data: cost }, { data: history }] = await Promise.all([
    db().from('product_costs').select('current_purchase_cost, currency, effective_at, source_purchase_id, source_supplier_id, source_history_id')
      .eq('tenant_id', tenantId).eq('product_id', productId).maybeSingle(),
    db().from('product_cost_history').select('id, received_at, created_at, cost_per_stock_unit, purchase_quantity, purchase_unit, purchase_unit_cost, conversion_factor, status')
      .eq('tenant_id', tenantId).eq('product_id', productId)
      .order('received_at', { ascending: false }).order('created_at', { ascending: false }).limit(10),
  ]);
  if (!cost) return null;
  const [{ data: purchase }, { data: supplier }] = await Promise.all([
    db().from('supplier_purchases').select('reference').eq('tenant_id', tenantId).eq('id', cost.source_purchase_id).maybeSingle(),
    cost.source_supplier_id
      ? db().from('suppliers').select('name').eq('tenant_id', tenantId).eq('id', cost.source_supplier_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  return {
    current_purchase_cost: num(cost.current_purchase_cost), currency: cost.currency, effective_at: cost.effective_at,
    purchase_id: cost.source_purchase_id, source_history_id: cost.source_history_id, purchase_reference: purchase?.reference ?? '', supplier_name: supplier?.name ?? null,
    // Même ordre que refresh_product_cost() (migration 142) : jour de réception
    // (fuseau Gestion), puis ordre d'enregistrement. Marge de 10 lignes pour trier.
    history: [...(history ?? [])].sort((x, y) => gestionToday(new Date(y.received_at)).localeCompare(gestionToday(new Date(x.received_at)))
      || String(y.created_at).localeCompare(String(x.created_at))).slice(0, 5).map((row) => ({
      id: row.id, received_at: row.received_at, cost_per_stock_unit: num(row.cost_per_stock_unit), purchase_quantity: num(row.purchase_quantity),
      purchase_unit: row.purchase_unit as PurchaseUnit, purchase_unit_cost: num(row.purchase_unit_cost),
      conversion_factor: num(row.conversion_factor), status: row.status as 'active' | 'reversed',
    })),
  };
}
