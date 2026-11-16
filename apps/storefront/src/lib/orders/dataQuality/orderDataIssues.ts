/**
 * Contrôle des données saisies par le client sur une commande (adresse,
 * destinataire). Règles pures et client-safe, imports relatifs uniquement :
 * lues par le classificateur des commandes (signalement dans l'admin, à la
 * lecture) et par le contrôle horaire (e-mail « Commande à vérifier »).
 *
 * Seulement des anomalies fiables, sur des commandes où l'équipe peut encore
 * corriger l'adresse dans Lepefy (livraison, pas expédiée, étiquette non
 * achetée). Jamais d'appel réseau : un code postal inconnu du transporteur
 * n'est pas vérifié ici.
 */

import { splitLine1, streetContainsRecipientName } from '../../address/addressRules';

export type OrderDataIssueCode = 'house_number_missing' | 'name_in_street' | 'recipient_name_incomplete';

export interface OrderDataIssue {
  code: OrderDataIssueCode;
  /** Phrase courte, en minuscule : « le numéro de la maison manque ». */
  description: string;
}

export interface OrderDataFacts {
  status: string;
  fulfillment_type?: string | null;
  tracking_code?: string | null;
  shipping_address?: { full_name?: string | null; line1?: string | null } | null;
}

const DESCRIPTIONS: Record<OrderDataIssueCode, string> = {
  house_number_missing: 'le numéro de la maison manque',
  name_in_street: 'le nom du destinataire est écrit dans la rue',
  recipient_name_incomplete: 'le nom du destinataire est incomplet (prénom et nom attendus)',
};

/** Statuts où l'adresse se corrige encore dans Lepefy (même règle que « Modifier l'adresse »). */
const OPEN_STATUSES = new Set(['new', 'preparing']);

const nameWordCount = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .split(/[^A-Za-z]+/).filter((word) => word.length >= 2).length;

/** Anomalies de l'adresse de livraison, dans un ordre stable ; [] si rien à signaler. */
export function orderDataIssues(order: OrderDataFacts): OrderDataIssue[] {
  if (order.fulfillment_type !== 'delivery' || !OPEN_STATUSES.has(order.status) || order.tracking_code?.trim()) return [];
  const address = order.shipping_address;
  if (!address || typeof address !== 'object') return [];
  const line1 = typeof address.line1 === 'string' ? address.line1.trim() : '';
  const fullName = typeof address.full_name === 'string' ? address.full_name.trim() : '';
  if (!line1) return [];

  const codes: OrderDataIssueCode[] = [];
  // splitLine1 : numéro = dernier mot avec un chiffre, ou « s.n. » (choix explicite du client, pas une anomalie).
  if (!splitLine1(line1).houseNumber) codes.push('house_number_missing');
  if (streetContainsRecipientName(line1, fullName)) codes.push('name_in_street');
  if (nameWordCount(fullName) < 2) codes.push('recipient_name_incomplete');
  return codes.map((code) => ({ code, description: DESCRIPTIONS[code] }));
}

/** FNV-1a 32 bits, en hexadécimal : empreinte stable sans exposer l'adresse. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Identifiant d'occurrence de l'alerte : mêmes anomalies sur la même adresse =
 * même identifiant (une seule notification) ; une adresse corrigée puis de
 * nouveau fausse produit un nouvel identifiant.
 */
export function orderDataIssueOccurrence(order: OrderDataFacts, issues: ReadonlyArray<OrderDataIssue>): string {
  const address = order.shipping_address ?? {};
  const key = `${address.line1 ?? ''}\u0000${address.full_name ?? ''}`;
  return `address:${issues.map((issue) => issue.code).join('+')}:${fingerprint(key)}`.slice(0, 120);
}

/**
 * Marche à suivre affichée dans l'admin et envoyée par e-mail. `providerName`
 * seulement quand un brouillon transporteur existe déjà (il garde l'ancienne
 * adresse et doit être refait).
 */
export function orderDataIssueSteps(issues: ReadonlyArray<OrderDataIssue>, providerName: string | null): string[] {
  const missing = issues.some((issue) => issue.code === 'house_number_missing');
  const steps = [
    `Contactez le client par téléphone ou par e-mail (coordonnées dans la commande)${missing ? ' : demandez le numéro de la maison et confirmez le nom de la rue' : ' et confirmez son adresse'}.`,
    'Corrigez l’adresse dans Lepefy : carte « Client & livraison » → « Modifier l’adresse ». Indiquez seulement la rue dans « Rue » et le numéro dans « N° », puis enregistrez.',
  ];
  if (providerName) {
    steps.push(`Refaites le brouillon ${providerName} : dans la carte « Expédition ${providerName} », supprimez le brouillon puis recréez-le. L’ancien brouillon garde la mauvaise adresse.`);
  }
  steps.push('Achetez l’étiquette comme d’habitude. Le suivi se met à jour tout seul dans Lepefy.');
  return steps;
}
