// Progress of the assisted order form (Nouvelle commande / Modifier). Pure:
// the form shows these steps as a live checklist; the server still validates
// everything again on submit.

export type AssistedMode = 'to_pay' | 'to_verify' | 'paid';
export type AssistedStepKey = 'origin' | 'customer' | 'products' | 'fulfillment' | 'payment';

export interface AssistedStepState {
  key: AssistedStepKey;
  label: string;
  done: boolean;
  /** Short recap shown next to a completed step title ("WhatsApp", "6 articles"). */
  summary: string | null;
  /** Blocking issues, in display order. */
  issues: string[];
}

export interface AssistedFormSnapshot {
  isEdit: boolean;
  salesChannelLabel: string | null;
  customerSelected: boolean;
  fullName: string;
  hasContact: boolean;
  unitCount: number;
  groupsUnavailable: boolean;
  quantityViolation: string | null;
  stockIssues: string[];
  fulfillment: 'delivery' | 'pickup';
  addressComplete: boolean;
  quoteValid: boolean;
  mode: AssistedMode;
  modeLabel: string;
  paidAtMissing: boolean;
}

export const ASSISTED_STEP_LABELS: Record<AssistedStepKey, string> = {
  origin: 'Origine',
  customer: 'Client',
  products: 'Produits',
  fulfillment: 'Remise',
  payment: 'Paiement',
};

/** The form steps with their state; `payment` is absent when editing a preorder. */
export function assistedFormSteps(form: AssistedFormSnapshot): AssistedStepState[] {
  const step = (key: AssistedStepKey, issues: string[], summary: string | null): AssistedStepState =>
    ({ key, label: ASSISTED_STEP_LABELS[key], done: issues.length === 0, summary: issues.length === 0 ? summary : null, issues });

  const productIssues: string[] = [];
  if (form.unitCount === 0) productIssues.push('Ajoutez au moins un produit.');
  if (form.groupsUnavailable && form.unitCount > 0) productIssues.push('Règles de quantité indisponibles : réessayez dans un instant.');
  if (form.quantityViolation) productIssues.push(form.quantityViolation);
  if (form.stockIssues.length > 0) productIssues.push(`Stock insuffisant : ${form.stockIssues.join(', ')}.`);

  const fulfillmentIssues: string[] = [];
  if (!form.addressComplete) fulfillmentIssues.push('Complétez l’adresse de livraison.');
  if (form.fulfillment === 'delivery' && !form.quoteValid) fulfillmentIssues.push('Calculez les frais de livraison.');

  const steps = [
    step('origin', form.salesChannelLabel ? [] : ['Choisissez l’origine de la commande.'], form.salesChannelLabel),
    step('customer', [
      ...(!form.fullName.trim() && !form.customerSelected ? ['Renseignez le nom du client.'] : []),
      ...(!form.hasContact ? ['Renseignez au moins un téléphone ou un e-mail.'] : []),
    ], form.customerSelected ? 'client existant' : 'nouveau client'),
    step('products', productIssues, `${form.unitCount} article${form.unitCount > 1 ? 's' : ''}`),
    step('fulfillment', fulfillmentIssues, form.fulfillment === 'pickup' ? 'retrait en magasin' : 'livraison'),
  ];
  if (!form.isEdit) steps.push(step('payment', form.mode === 'paid' && form.paidAtMissing ? ['Indiquez la date d’encaissement.'] : [], form.modeLabel));
  return steps;
}

export interface AssistedIssue { step: AssistedStepKey; message: string }

/**
 * Issues blocking a submit. A draft may be saved without shipping quote nor
 * payment date (same rule as before: those are only needed to send or record).
 */
export function assistedFormIssues(steps: AssistedStepState[], kind: 'main' | 'draft'): AssistedIssue[] {
  return steps.flatMap((step) => step.issues
    .filter((message) => kind === 'main' || (message !== 'Calculez les frais de livraison.' && message !== 'Indiquez la date d’encaissement.'))
    .map((message) => ({ step: step.key, message })));
}

/** Explicit label of the main button (long on desktop, short on the mobile bar). */
export function assistedPrimaryLabel(mode: AssistedMode, isEdit: boolean, short = false): string {
  if (isEdit) return short ? 'Enregistrer' : 'Enregistrer les modifications';
  if (mode === 'to_pay') return short ? 'Créer et envoyer le lien' : 'Créer la précommande et le lien';
  if (mode === 'to_verify') return short ? 'Enregistrer à vérifier' : 'Enregistrer le paiement à vérifier';
  return short ? 'Créer la commande payée' : 'Créer la commande payée';
}

// ─── Reorder from the customer's last order ───────────────────────────────

export interface ReorderProduct {
  id: string;
  name: string;
  stock: number;
  min_order_quantity: number;
  order_quantity_step: number;
}

export interface ReorderResult<P extends ReorderProduct> {
  lines: Array<{ product: P; quantity: number }>;
  /** Items not added (inactive product or no purchasable quantity). */
  skipped: string[];
  /** Items added with a different quantity (stock or minimum / step). */
  adjusted: string[];
}

/** Largest valid quantity (minimum + step, within stock) not above `wanted`, or the minimum when `wanted` is below it. */
export function snapQuantity(wanted: number, product: ReorderProduct): number | null {
  const min = Math.max(1, product.min_order_quantity);
  const step = Math.max(1, product.order_quantity_step);
  const cap = Math.min(Math.max(wanted, min), product.stock);
  if (cap < min) return null;
  return min + Math.floor((cap - min) / step) * step;
}

/**
 * Lines to add from a past order, with today's products: inactive products are
 * skipped, quantities snap to the current rules and stock. Server-side
 * validation still applies on submit.
 */
export function reorderLines<P extends ReorderProduct>(
  items: Array<{ productId: string | null; name: string; quantity: number }>,
  products: P[],
): ReorderResult<P> {
  const byId = new Map(products.map((product) => [product.id, product]));
  const result: ReorderResult<P> = { lines: [], skipped: [], adjusted: [] };
  const seen = new Set<string>();
  for (const item of items) {
    const product = item.productId ? byId.get(item.productId) : undefined;
    if (!product || seen.has(product.id)) { if (!product) result.skipped.push(item.name); continue; }
    seen.add(product.id);
    const quantity = snapQuantity(item.quantity, product);
    if (quantity === null) { result.skipped.push(product.name); continue; }
    if (quantity !== item.quantity) result.adjusted.push(product.name);
    result.lines.push({ product, quantity });
  }
  return result;
}
