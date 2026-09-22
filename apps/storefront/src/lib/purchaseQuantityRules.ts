/**
 * Purchase quantity rules — quantità minima + incremento ("step"), applicabile
 * sia a un singolo prodotto sia al totale aggregato di un gruppo combinabile
 * (es. "Boissons": minimo 12, step 6, mix libero tra le referenze del gruppo).
 *
 * Una quantità `q` è valida se:
 *   q >= minimum AND (q - minimum) % step == 0
 *
 * Funzioni pure, senza I/O: riutilizzate sia lato client (cartStore, UI di
 * quantità) sia lato server (validazione checkout) per evitare che le due
 * superfici calcolino la regola in modo divergente.
 */

export interface QuantityRuleState {
  currentQuantity: number;
  minimumQuantity: number;
  step: number;
  isValid: boolean;
  /** Prima quantità valida >= currentQuantity (== currentQuantity se già valida). */
  nextValidQuantity: number;
  /** Unità mancanti per raggiungere nextValidQuantity (0 se già valida). */
  missingQuantity: number;
}

/**
 * Calcola lo stato di una regola minimo+step per una quantità corrente.
 * `minimum` e `step` vengono normalizzati a >= 1 (una regola 0/0 non ha senso
 * commerciale e romperebbe il modulo, cf. `(q - minimum) % step`).
 */
export function computeQuantityRuleState(
  currentQuantity: number,
  minimumQuantity: number,
  step: number,
): QuantityRuleState {
  const minimum = Math.max(1, Math.trunc(minimumQuantity) || 1);
  const s = Math.max(1, Math.trunc(step) || 1);
  const current = Math.max(0, Math.trunc(currentQuantity) || 0);

  let nextValidQuantity: number;
  if (current < minimum) {
    nextValidQuantity = minimum;
  } else {
    const overshoot = (current - minimum) % s;
    nextValidQuantity = overshoot === 0 ? current : current + (s - overshoot);
  }

  const isValid = current > 0 && current === nextValidQuantity;

  return {
    currentQuantity: current,
    minimumQuantity: minimum,
    step: s,
    isValid,
    nextValidQuantity,
    missingQuantity: Math.max(0, nextValidQuantity - current),
  };
}

/** Prodotto minimale necessario per validare la regola di quantità del singolo SKU. */
export interface QuantityRuleProduct {
  id: string;
  name: string;
  min_order_quantity: number;
  order_quantity_step: number;
}

/** Gruppo combinabile minimale necessario per validare la regola aggregata. */
export interface QuantityRuleGroup {
  id: string;
  name: string;
  min_quantity: number;
  quantity_step: number;
  /** id dei prodotti membri del gruppo. */
  productIds: string[];
}

export type QuantityRuleViolationType =
  | 'PRODUCT_MINIMUM'
  | 'PRODUCT_STEP'
  | 'GROUP_MINIMUM'
  | 'GROUP_STEP';

export interface QuantityRuleViolation {
  type: QuantityRuleViolationType;
  productId?: string;
  productName?: string;
  groupId?: string;
  groupName?: string;
  requiredMinimum: number;
  step: number;
  currentQuantity: number;
  nextValidQuantity: number;
  missingQuantity: number;
}

/**
 * Valida l'intero carrello contro le regole di quantità (prodotto + gruppo).
 * Ritorna la lista di violazioni — vuota se il carrello è "checkout eligible".
 * Il carrello può restare temporaneamente incompleto durante la costruzione
 * (cf. design doc §4): questa funzione è pensata per essere invocata solo nel
 * punto in cui l'eligibilità va effettivamente verificata (checkout), non ad
 * ogni mutazione del carrello.
 */
export function validatePurchaseQuantityRules(
  quantityByProductId: Map<string, number>,
  products: QuantityRuleProduct[],
  groups: QuantityRuleGroup[],
): QuantityRuleViolation[] {
  const violations: QuantityRuleViolation[] = [];

  for (const product of products) {
    const quantity = quantityByProductId.get(product.id);
    if (!quantity) continue; // prodotto non presente nel carrello: nessuna regola da rispettare
    const state = computeQuantityRuleState(quantity, product.min_order_quantity, product.order_quantity_step);
    if (state.isValid) continue;
    violations.push({
      type: state.currentQuantity < state.minimumQuantity ? 'PRODUCT_MINIMUM' : 'PRODUCT_STEP',
      productId: product.id,
      productName: product.name,
      requiredMinimum: state.minimumQuantity,
      step: state.step,
      currentQuantity: state.currentQuantity,
      nextValidQuantity: state.nextValidQuantity,
      missingQuantity: state.missingQuantity,
    });
  }

  for (const group of groups) {
    const total = group.productIds.reduce((sum, id) => sum + (quantityByProductId.get(id) ?? 0), 0);
    if (total === 0) continue; // nessun prodotto del gruppo nel carrello: nessuna regola da rispettare
    const state = computeQuantityRuleState(total, group.min_quantity, group.quantity_step);
    if (state.isValid) continue;
    violations.push({
      type: state.currentQuantity < state.minimumQuantity ? 'GROUP_MINIMUM' : 'GROUP_STEP',
      groupId: group.id,
      groupName: group.name,
      requiredMinimum: state.minimumQuantity,
      step: state.step,
      currentQuantity: state.currentQuantity,
      nextValidQuantity: state.nextValidQuantity,
      missingQuantity: state.missingQuantity,
    });
  }

  return violations;
}

/**
 * Message d'erreur canonique pour une violation — utilisé aussi bien par la
 * validation serveur (checkout) que par les points de blocage côté client
 * (panier, formulaire de checkout) : même texte partout, jamais une version
 * "client" qui diverge de celle qui bloque réellement au serveur.
 */
export function formatQuantityViolationMessage(violation: QuantityRuleViolation): string {
  const label = violation.groupName ?? violation.productName ?? 'Un article';
  return `${label} : quantité minimale ${violation.requiredMinimum}${violation.step > 1 ? ` par ${violation.step}` : ''}. Ajoutez encore ${violation.missingQuantity} unité(s).`;
}
