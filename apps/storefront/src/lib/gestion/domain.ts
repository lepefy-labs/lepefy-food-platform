/**
 * Gestion du commerce: costanti, etichette e regole pure (nessun I/O).
 * Importabile da server, client e test. Le regole autorevoli restano nel DB
 * (migration 139): qui solo la stessa semantica per UI e pre-validazione.
 */

export const BUSINESS_MANAGEMENT_FLAG = 'business_management';

export const PURCHASE_STATUSES = ['draft', 'ordered', 'partially_received', 'received', 'cancelled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'bank_transfer', 'card', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['recorded', 'verified', 'voided'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const BENEFICIARY_TYPES = ['supplier', 'third_party'] as const;
export type BeneficiaryType = (typeof BENEFICIARY_TYPES)[number];

export const DOCUMENT_ENTITY_TYPES = ['supplier', 'purchase', 'receipt', 'supplier_payment'] as const;
export type DocumentEntityType = (typeof DOCUMENT_ENTITY_TYPES)[number];

export const DOCUMENT_TYPES = ['invoice', 'receipt', 'delivery_note', 'payment_proof', 'supplier_instruction', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const DOCUMENTS_BUCKET = 'business-documents';

/** Capability che danno accesso ad almeno una parte di Gestion. */
export const GESTION_VIEW_PERMISSIONS = ['suppliers.view', 'purchases.view', 'treasury.view', 'inventory.view'] as const;

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: 'Brouillon',
  ordered: 'Commandé',
  partially_received: 'Reçu partiellement',
  received: 'Reçu',
  cancelled: 'Annulé',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  recorded: 'Enregistré, à vérifier',
  verified: 'Vérifié',
  voided: 'Annulé',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  bank_transfer: 'Virement',
  card: 'Carte',
  other: 'Autre',
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  invoice: 'Facture',
  receipt: 'Reçu',
  delivery_note: 'Bon de livraison',
  payment_proof: 'Justificatif de paiement',
  supplier_instruction: 'Instruction du fournisseur',
  other: 'Autre',
};

export type Tone = 'neutral' | 'info' | 'warn' | 'success' | 'danger';

export const PURCHASE_STATUS_TONES: Record<PurchaseStatus, Tone> = {
  draft: 'neutral',
  ordered: 'info',
  partially_received: 'warn',
  received: 'success',
  cancelled: 'danger',
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, Tone> = {
  recorded: 'warn',
  verified: 'success',
  voided: 'danger',
};

export interface PurchaseFinancials {
  status: PurchaseStatus;
  total: number;
  paid_verified: number;
  paid_unverified: number;
  outstanding: number;
}

export type PaymentState = 'cancelled' | 'paid' | 'to_verify' | 'partially_paid' | 'to_pay' | 'nothing_due';

/**
 * Stato finanziario leggibile di un acquisto, separato dallo stato merce.
 * Solo i pagamenti verificati riducono il debito: un pagamento registrato non
 * verificato produce "à vérifier", mai "payé".
 */
export function purchasePaymentState(f: PurchaseFinancials): PaymentState {
  if (f.status === 'cancelled') return 'cancelled';
  if (f.total <= 0) return 'nothing_due';
  if (f.outstanding <= 0) return 'paid';
  if (f.paid_unverified > 0) return 'to_verify';
  if (f.paid_verified > 0) return 'partially_paid';
  return 'to_pay';
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  cancelled: 'Annulé',
  paid: 'Payé vérifié',
  to_verify: 'Paiement à vérifier',
  partially_paid: 'Payé partiellement',
  to_pay: 'À payer',
  nothing_due: 'Rien à payer',
};

export const PAYMENT_STATE_TONES: Record<PaymentState, Tone> = {
  cancelled: 'danger',
  paid: 'success',
  to_verify: 'warn',
  partially_paid: 'info',
  to_pay: 'warn',
  nothing_due: 'neutral',
};

/** Percentuale di merce ricevuta (0-100, arrotondata per difetto). */
export function receivedPercent(ordered: number, received: number): number {
  if (ordered <= 0) return 0;
  return Math.min(100, Math.floor((received / ordered) * 100));
}

export interface AllocationDraft {
  purchaseId: string;
  amount: number;
}

export interface AllocatablePurchase {
  id: string;
  allocatable: number;
  currency: string;
  supplierId: string;
  status: PurchaseStatus;
}

export type AllocationIssue =
  | 'invalid_amount'
  | 'duplicate_purchase'
  | 'unknown_purchase'
  | 'purchase_cancelled'
  | 'supplier_mismatch'
  | 'currency_mismatch'
  | 'purchase_over_allocated'
  | 'payment_over_allocated';

const cents = (value: number) => Math.round(value * 100);

/** Importo positivo con al massimo 2 decimali (stesso vincolo delle RPC). */
export function isMoneyAmount(value: number): boolean {
  return Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
}

/**
 * Pre-validazione di un piano di allocazione (UI e API). Il DB riesegue gli
 * stessi controlli sotto lock: questa funzione serve solo a dare un errore
 * chiaro prima della chiamata.
 */
export function validateAllocationPlan(
  paymentAmount: number,
  payment: { supplierId: string; currency: string },
  allocations: AllocationDraft[],
  purchases: AllocatablePurchase[],
): AllocationIssue | null {
  const seen = new Set<string>();
  let total = 0;
  for (const allocation of allocations) {
    if (!isMoneyAmount(allocation.amount)) return 'invalid_amount';
    if (seen.has(allocation.purchaseId)) return 'duplicate_purchase';
    seen.add(allocation.purchaseId);
    const purchase = purchases.find((candidate) => candidate.id === allocation.purchaseId);
    if (!purchase) return 'unknown_purchase';
    if (purchase.status === 'cancelled') return 'purchase_cancelled';
    if (purchase.supplierId !== payment.supplierId) return 'supplier_mismatch';
    if (purchase.currency !== payment.currency) return 'currency_mismatch';
    if (cents(allocation.amount) > cents(purchase.allocatable)) return 'purchase_over_allocated';
    total += cents(allocation.amount);
  }
  if (total > cents(paymentAmount)) return 'payment_over_allocated';
  return null;
}

const REFERENCE_PATTERNS = {
  supplier: /^FOU-\d{6}$/,
  purchase: /^ACH-\d{4}-\d{6}$/,
  receipt: /^REC-\d{4}-\d{6}$/,
  payment: /^PAY-\d{4}-\d{6}$/,
} as const;

/** Formato dei riferimenti generati da next_business_reference() (migration 139). */
export function isBusinessReference(scope: keyof typeof REFERENCE_PATTERNS, value: string): boolean {
  return REFERENCE_PATTERNS[scope].test(value);
}
