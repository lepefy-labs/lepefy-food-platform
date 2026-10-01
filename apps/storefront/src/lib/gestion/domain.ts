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

export type PaymentState = 'cancelled' | 'not_committed' | 'paid' | 'to_verify' | 'partially_paid' | 'to_pay' | 'nothing_due';

/**
 * Stato finanziario leggibile di un acquisto, separato dallo stato merce.
 * Solo i pagamenti verificati riducono il debito: un pagamento registrato non
 * verificato produce "à vérifier", mai "payé".
 */
export function purchasePaymentState(f: PurchaseFinancials): PaymentState {
  if (f.status === 'cancelled') return 'cancelled';
  // Un achat en brouillon n'engage pas encore : aucune dette (migration 140).
  if (f.status === 'draft') return 'not_committed';
  if (f.total <= 0) return 'nothing_due';
  if (f.outstanding <= 0) return 'paid';
  if (f.paid_unverified > 0) return 'to_verify';
  if (f.paid_verified > 0) return 'partially_paid';
  return 'to_pay';
}

export const PAYMENT_STATE_LABELS: Record<PaymentState, string> = {
  cancelled: 'Annulé',
  not_committed: 'Pas encore engagé',
  paid: 'Payé vérifié',
  to_verify: 'Paiement à vérifier',
  partially_paid: 'Payé partiellement',
  to_pay: 'À payer',
  nothing_due: 'Rien à payer',
};

export const PAYMENT_STATE_TONES: Record<PaymentState, Tone> = {
  cancelled: 'danger',
  not_committed: 'neutral',
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

// ─── Fase 1.1: unità d'acquisto ──────────────────────────────────────────────

export const PURCHASE_UNITS = ['unit', 'kg', 'g', 'l', 'ml', 'pack', 'box', 'carton', 'other'] as const;
export type PurchaseUnit = (typeof PURCHASE_UNITS)[number];

/** Libellé court (sélecteurs, colonnes). */
export const PURCHASE_UNIT_LABELS: Record<PurchaseUnit, string> = {
  unit: 'unité', kg: 'kg', g: 'g', l: 'L', ml: 'ml', pack: 'pack', box: 'boîte', carton: 'carton', other: 'autre',
};

// ─── Fase 1.1: échéances de paiement ─────────────────────────────────────────

/** Fenêtre « bientôt dû ». */
export const DUE_SOON_DAYS = 7;

/**
 * Fuseau de la date du jour pour les échéances. Les dates d'achat et
 * d'échéance sont des dates calendaires ; seul « aujourd'hui » en dépend.
 */
export const GESTION_TIME_ZONE = 'Europe/Paris';

/** Date du jour (YYYY-MM-DD) dans le fuseau Gestion. */
export function gestionToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GESTION_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Ajoute n jours à une date calendaire YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Écart en jours calendaires (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}

/**
 * Horodatage envoyé pour une réception datée `date` (YYYY-MM-DD) : jamais dans le
 * futur. Aujourd'hui (ou plus tard) = null, le serveur prend l'instant de
 * l'enregistrement ; un jour passé = midi local de ce jour.
 */
export function receivedAtForDate(date: string, today: string): string | null {
  if (date >= today) return null;
  return new Date(`${date}T12:00:00`).toISOString();
}

/** Tolérance d'horloge client/serveur pour refuser une réception datée dans le futur. */
export const RECEIVED_AT_MAX_SKEW_MS = 5 * 60 * 1000;

export type DueState ='cancelled' | 'not_committed' | 'paid' | 'no_due' | 'overdue' | 'today' | 'due_soon' | 'upcoming';

export interface DueInfo {
  state: DueState;
  /** Jours restants (> 0), 0 aujourd'hui, jours de retard en négatif. Null sans échéance. */
  days: number | null;
}

/**
 * État d'échéance dérivé (jamais stocké) de payment_due_date + reste à payer + statut.
 * Brouillon et annulé ne sont jamais en retard ; reste 0 = payé quelle que soit la date.
 */
export function dueInfo(
  p: { status: PurchaseStatus; outstanding: number; total: number; payment_due_date: string | null },
  today: string,
): DueInfo {
  if (p.status === 'cancelled') return { state: 'cancelled', days: null };
  if (p.status === 'draft') return { state: 'not_committed', days: null };
  if (p.outstanding <= 0) return { state: p.total > 0 ? 'paid' : 'no_due', days: null };
  if (!p.payment_due_date) return { state: 'no_due', days: null };
  const days = daysBetween(today, p.payment_due_date);
  if (days < 0) return { state: 'overdue', days };
  if (days === 0) return { state: 'today', days };
  if (days <= DUE_SOON_DAYS) return { state: 'due_soon', days };
  return { state: 'upcoming', days };
}

export function dueLabel(info: DueInfo): string {
  switch (info.state) {
    case 'cancelled': return 'Annulé';
    case 'not_committed': return 'Pas encore engagé';
    case 'paid': return 'Payé';
    case 'no_due': return 'Pas d\'échéance';
    case 'today': return 'Aujourd\'hui';
    case 'overdue': {
      const late = -(info.days ?? 0);
      return `En retard de ${late} jour${late > 1 ? 's' : ''}`;
    }
    case 'due_soon': return `À payer sous ${info.days} jour${(info.days ?? 0) > 1 ? 's' : ''}`;
    default: return 'À venir';
  }
}

export const DUE_STATE_TONES: Record<DueState, Tone> = {
  cancelled: 'neutral', not_committed: 'neutral', paid: 'success', no_due: 'neutral',
  overdue: 'danger', today: 'warn', due_soon: 'warn', upcoming: 'info',
};

/** Conditions de paiement proposées (persistance : nombre de jours, aucune énumération figée). */
export const PAYMENT_TERMS_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: 'Paiement immédiat' },
  { value: 30, label: '30 jours' },
  { value: 60, label: '60 jours' },
  { value: 90, label: '90 jours' },
];

export function paymentTermsLabel(days: number | null): string {
  if (days === null) return 'Non définies';
  return PAYMENT_TERMS_PRESETS.find((preset) => preset.value === days)?.label ?? `${days} jours`;
}

// ─── Fase 1.1: stock ─────────────────────────────────────────────────────────

export const MOVEMENT_TYPES = ['supplier_receipt', 'manual_adjustment', 'reversal'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  supplier_receipt: 'Réception fournisseur',
  manual_adjustment: 'Rectification',
  reversal: 'Annulation de réception',
};

/** Motifs proposés pour une rectification (motif libre accepté, toujours obligatoire). */
export const ADJUSTMENT_REASONS = ['Erreur de comptage', 'Inventaire physique', 'Casse', 'Produit perdu', 'Produit périmé'] as const;

/** Marge brute indicative (jamais présentée comme marge nette ou comptable). */
export function indicativeMargin(price: number, cost: number): { amount: number; percent: number | null } {
  const amount = Math.round((price - cost) * 100) / 100;
  return { amount, percent: price > 0 ? Math.round((amount / price) * 1000) / 10 : null };
}

export interface DueTotals {
  toPay: number;
  toPayCount: number;
  dueSoon: number;
  dueSoonCount: number;
  overdue: number;
  overdueCount: number;
  noDueCount: number;
}

/** Agrégats d'échéance (reste à payer des achats engagés, jamais les brouillons). */
export function summarizeDues(
  rows: { purchase_id: string; outstanding: number; payment_due_date: string | null }[],
  today: string,
): DueTotals {
  const soonLimit = addDays(today, DUE_SOON_DAYS);
  const open = rows.filter((row) => row.outstanding > 0);
  const cents = (list: typeof open) => list.reduce((sum, row) => sum + Math.round(row.outstanding * 100), 0) / 100;
  const overdue = open.filter((row) => row.payment_due_date !== null && row.payment_due_date < today);
  const soon = open.filter((row) => row.payment_due_date !== null && row.payment_due_date >= today && row.payment_due_date <= soonLimit);
  return {
    toPay: cents(open), toPayCount: open.length,
    dueSoon: cents(soon), dueSoonCount: soon.length,
    overdue: cents(overdue), overdueCount: overdue.length,
    noDueCount: open.filter((row) => row.payment_due_date === null).length,
  };
}


/**
 * Avancement de réception d'un achat, ligne par ligne (les unités kg, L, cartons
 * ne s'additionnent pas) : moyenne des taux de réception, arrondie par défaut.
 */
export function receiptProgress(items: { ordered_quantity: number; received_quantity: number }[]): { percent: number; completeLines: number; lines: number } {
  const lines = items.filter((item) => item.ordered_quantity > 0);
  if (!lines.length) return { percent: 0, completeLines: 0, lines: 0 };
  const ratios = lines.map((item) => Math.min(1, item.received_quantity / item.ordered_quantity));
  const completeLines = lines.filter((item) => Math.round(item.received_quantity * 1000) >= Math.round(item.ordered_quantity * 1000)).length;
  const percent = completeLines === lines.length ? 100 : Math.min(99, Math.floor((ratios.reduce((sum, ratio) => sum + ratio, 0) / lines.length) * 100));
  return { percent, completeLines, lines: lines.length };
}

