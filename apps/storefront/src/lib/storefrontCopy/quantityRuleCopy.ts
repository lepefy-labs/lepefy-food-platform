/**
 * Phrases des règles d'achat (minimum, pas, groupes à mélanger). Texte
 * seulement : le calcul reste dans `lib/purchaseQuantityRules.ts`, qui
 * importe ce module pour son message canonique (même texte côté client et
 * serveur). Imports relatifs uniquement.
 */

import { formatPrice } from '../utils/format';

/** « 6, 8, 10… » — les trois quantités suivantes possibles. */
export function nextQuantitiesList(minimum: number, step: number, from = minimum): string {
  const values = [from + step, from + step * 2, from + step * 3];
  return `${values.join(', ')}…`;
}

/** « Achetez 4 paquets minimum. » / « Achetez-en 4 minimum. » */
export function minimumHeadline(minimum: number, noun: string | null): string {
  return noun ? `Achetez ${minimum} ${noun} minimum.` : `Achetez-en ${minimum} minimum.`;
}

/** « Ensuite : 6, 8, 10… » ; null sans pas (> 1). */
export function stepLine(minimum: number, step: number): string | null {
  return step > 1 ? `Ensuite : ${nextQuantitiesList(minimum, step)}` : null;
}

/** Puce de carte : « 4 minimum · 10,00 € ». */
export function minimumChip(minimum: number, unitPrice: number, currency = 'EUR'): string {
  return `${minimum} minimum · ${formatPrice(unitPrice * minimum, currency)}`;
}

/** « Boissons : mélangez pour arriver à 12. » */
export function groupHeadline(groupName: string, minimum: number): string {
  return `${groupName} : mélangez les produits pour arriver à ${minimum}.`;
}

export interface GroupProgressCopy {
  done: boolean;
  title: string;
  detail: string;
}

/** Avancement d'un groupe à mélanger, une fois entamé. */
export function groupProgressCopy(groupName: string, current: number, target: number, minimum: number): GroupProgressCopy {
  const missing = Math.max(0, target - current);
  if (missing === 0) {
    return { done: true, title: `C'est bon pour « ${groupName} » (${current}).`, detail: '' };
  }
  return {
    done: false,
    title: `${groupName} : encore ${missing} à ajouter`,
    detail: target === minimum
      ? `Vous en avez ${current}. Il en faut ${minimum} minimum, et vous pouvez mélanger les produits.`
      : `Vous en avez ${current}. Ajoutez-en ${missing} pour arriver à ${target}. Vous pouvez mélanger les produits.`,
  };
}

export type QuantityViolationKind = 'PRODUCT_MINIMUM' | 'PRODUCT_STEP' | 'GROUP_MINIMUM' | 'GROUP_STEP';

export interface QuantityViolationCopyInput {
  type: QuantityViolationKind;
  label: string;
  requiredMinimum: number;
  step: number;
  nextValidQuantity: number;
  missingQuantity: number;
}

/** Message canonique d'une violation (panier, checkout, API). */
export function quantityViolationCopy(v: QuantityViolationCopyInput): string {
  const sequence = `${v.requiredMinimum}, ${nextQuantitiesList(v.requiredMinimum, v.step)}`;
  switch (v.type) {
    case 'PRODUCT_MINIMUM':
      return `${v.label} : achetez-en ${v.requiredMinimum} minimum. Ajoutez-en encore ${v.missingQuantity}.`;
    case 'PRODUCT_STEP':
      return `${v.label} : se vend par ${v.step} (${sequence}). Ajoutez-en encore ${v.missingQuantity} pour arriver à ${v.nextValidQuantity}.`;
    case 'GROUP_MINIMUM':
      return `${v.label} : encore ${v.missingQuantity} à ajouter. Il en faut ${v.requiredMinimum} minimum, et vous pouvez mélanger les produits.`;
    case 'GROUP_STEP':
      return `${v.label} : se vend par ${v.step} (${sequence}). Encore ${v.missingQuantity} à ajouter pour arriver à ${v.nextValidQuantity}.`;
  }
}
