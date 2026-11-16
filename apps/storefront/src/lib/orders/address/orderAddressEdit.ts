/**
 * Correction de l'adresse de livraison d'une commande par l'équipe (admin).
 * Règles pures, partagées par la route (autorité) et le dialogue (guidage).
 * Imports relatifs uniquement.
 *
 * Ce que la correction ne fait jamais : recalculer le prix de livraison,
 * changer de pays, prévenir le client, ou modifier un brouillon/une étiquette
 * chez le transporteur. Le nom du client de la commande (`orders.full_name`)
 * ne change pas : seul le destinataire de l'adresse est corrigé.
 */

import {
  normalizeShippingAddress,
  splitLine1,
  type NormalizedShippingAddress,
} from '../../address/addressRules';
import { ADDRESS_COPY } from '../../storefrontCopy/addressCopy';
import { normalizePhoneForStorage, hasUsableDigits } from '../../phone/internationalPhone';

/** Faits de la commande nécessaires à la décision. */
export interface AddressEditOrderFacts {
  status: string;
  fulfillment_type?: string | null;
  tracking_code?: string | null;
  shipping_provider_reference?: string | null;
  shipping_creation_status?: string | null;
  shipping_address?: Partial<NormalizedShippingAddress> | null;
}

export type AddressEditBlocker = 'not_delivery' | 'closed' | 'shipped' | 'label_purchased' | 'draft_in_progress' | 'no_address';

export const ADDRESS_EDIT_BLOCKER_MESSAGES: Record<AddressEditBlocker, string> = {
  not_delivery: 'Cette commande est un retrait en boutique : elle n’a pas d’adresse de livraison.',
  closed: 'Cette commande est livrée ou annulée : son adresse ne peut plus être modifiée.',
  shipped: 'Le colis est déjà parti : corrigez l’adresse directement avec le transporteur.',
  label_purchased: 'L’étiquette est déjà achetée : l’adresse ne peut plus changer ici. Annulez l’étiquette dans Packlink PRO ou corrigez-la avec le transporteur.',
  draft_in_progress: 'Le brouillon d’expédition est en cours de création. Réessayez dans une minute.',
  no_address: 'Cette commande n’a pas d’adresse enregistrée.',
};

/** Pourquoi l'adresse ne peut pas être corrigée, ou null si elle peut l'être. */
export function addressEditBlocker(order: AddressEditOrderFacts): AddressEditBlocker | null {
  if (order.fulfillment_type === 'pickup') return 'not_delivery';
  if (order.status === 'delivered' || order.status === 'cancelled') return 'closed';
  if (order.status === 'shipped') return 'shipped';
  // Un numéro de suivi = étiquette achetée : le transporteur a déjà l'adresse.
  if (order.tracking_code?.trim()) return 'label_purchased';
  if (order.shipping_creation_status === 'creating') return 'draft_in_progress';
  if (!order.shipping_address || typeof order.shipping_address !== 'object') return 'no_address';
  return null;
}

/**
 * Un brouillon non acheté existe chez le transporteur : il garde l'ancienne
 * adresse tant que l'équipe ne le supprime pas puis le recrée.
 */
export function providerDraftKeepsOldAddress(order: Pick<AddressEditOrderFacts, 'shipping_provider_reference' | 'tracking_code'>): boolean {
  return Boolean(order.shipping_provider_reference?.trim()) && !order.tracking_code?.trim();
}

export interface AddressEditInput {
  full_name: unknown;
  company_name?: unknown;
  line1: unknown;
  line2?: unknown;
  postal_code: unknown;
  city: unknown;
  country: unknown;
  phone?: unknown;
}

export type AddressEditResult =
  | { ok: true; address: NormalizedShippingAddress; changedFields: string[]; postalCodeChanged: boolean }
  | { ok: false; field: string; error: string };

const FIELDS: Array<keyof NormalizedShippingAddress> = ['full_name', 'company_name', 'line1', 'line2', 'postal_code', 'city', 'country', 'phone'];

/**
 * Nouvelle adresse = contrôle du checkout (champs connus, longueurs, code
 * postal, nom dans la rue) + règles plus strictes pour l'équipe : numéro de
 * maison obligatoire (chiffre ou « s.n. ») et pays inchangé (le prix payé en
 * dépend). Le téléphone vide garde l'ancien.
 */
export function buildEditedShippingAddress(current: Partial<NormalizedShippingAddress>, input: AddressEditInput): AddressEditResult {
  const normalized = normalizeShippingAddress(input);
  if (!normalized.ok) return normalized;
  const address = normalized.address;

  const currentCountry = typeof current.country === 'string' ? current.country.trim().toUpperCase() : '';
  if (currentCountry && address.country !== currentCountry) {
    return { ok: false, field: 'country', error: 'Le pays ne peut pas changer : le prix de livraison payé en dépend.' };
  }
  // splitLine1 ne reconnaît un numéro que s'il contient un chiffre (ou « s.n. »).
  if (!splitLine1(address.line1).houseNumber) return { ok: false, field: 'line1', error: ADDRESS_COPY.houseNumberRequired };

  const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : '';
  if (rawPhone) {
    const phone = normalizePhoneForStorage(rawPhone, address.country);
    if (!phone.value || !hasUsableDigits(phone.value)) return { ok: false, field: 'phone', error: 'Vérifiez le numéro de téléphone.' };
    address.phone = phone.value;
  } else if (typeof current.phone === 'string' && current.phone.trim()) {
    address.phone = current.phone.trim();
  }

  const changedFields = FIELDS.filter((field) => (current[field] ?? '') !== (address[field] ?? ''));
  return { ok: true, address, changedFields, postalCodeChanged: changedFields.includes('postal_code') };
}
