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

import { distinctAddressLine2, splitLine1, streetContainsRecipientName } from '../../address/addressRules';

export type OrderDataIssueCode =
  | 'house_number_missing'
  | 'street_type_missing'
  | 'house_number_repeated'
  | 'name_in_street'
  | 'recipient_name_incomplete';

export interface OrderDataIssue {
  code: OrderDataIssueCode;
  /** Phrase courte, en minuscule : « le numéro de la maison manque ». */
  description: string;
}

export interface OrderDataFacts {
  status: string;
  fulfillment_type?: string | null;
  tracking_code?: string | null;
  shipping_address?: { full_name?: string | null; line1?: string | null; line2?: string | null; country?: string | null } | null;
}

const DESCRIPTIONS: Record<OrderDataIssueCode, string> = {
  house_number_missing: 'le numéro de la maison manque',
  street_type_missing: 'le type de voie manque devant le nom de la rue (Via, Piazza…)',
  house_number_repeated: 'le numéro de la maison est répété dans le complément d’adresse',
  name_in_street: 'le nom du destinataire est écrit dans la rue',
  recipient_name_incomplete: 'le nom du destinataire est incomplet (prénom et nom attendus)',
};

/** Statuts où l'adresse se corrige encore dans Lepefy (même règle que « Modifier l'adresse »). */
const OPEN_STATUSES = new Set(['new', 'preparing']);

/**
 * Types de voie italiens (odonymes) et abréviations courantes, sans accents
 * ni points. Une rue italienne commence par l'un d'eux (« Via Roma »,
 * « P.za Garibaldi », « Loc. Santa Maria ») ; « Roma 10 » seul n'est pas fiable
 * pour le transporteur. Liste large : un type rare non listé ferait signaler à
 * tort une adresse correcte (l'équipe vérifie, rien n'est bloqué).
 */
const IT_STREET_TYPES = new Set([
  'via', 'v', 'viale', 'vle', 'vl', 'vialetto', 'piazza', 'p', 'pza', 'pzza', 'pz', 'piazzale', 'ple', 'pzle', 'piazzetta',
  'corso', 'c', 'cso', 'largo', 'lgo', 'lg', 'vicolo', 'vic', 'vico', 'viuzza', 'strada', 'str', 'stradella', 'stradone', 'stradale',
  'contrada', 'cda', 'ctr', 'contra', 'localita', 'loc', 'lc', 'frazione', 'fraz', 'fr', 'borgo', 'borgata', 'bgo', 'salita', 'sal',
  'scalinata', 'discesa', 'traversa', 'trav', 'tr', 'rione', 'calle', 'campo', 'campiello', 'fondamenta', 'sestiere', 'salizada',
  'ramo', 'rio', 'regione', 'reg', 'circonvallazione', 'circ', 'lungomare', 'lungotevere', 'lungarno', 'lungolago', 'lungofiume',
  'lungadige', 'lungo', 'galleria', 'gall', 'passaggio', 'pass', 'passeggiata', 'percorso', 'sentiero', 'parco', 'residence',
  'residenza', 'res', 'zona', 'quartiere', 'qre', 'q', 'cascina', 'cascine', 'case', 'casale', 'podere', 'masseria', 'villaggio',
  'vill', 'rotonda', 'rampa', 'ripa', 'riviera', 'belvedere', 'baluardo', 'bastioni', 'bastione', 'cortile', 'corte', 'molo',
  'banchina', 'calata', 'sottoportico', 'supportico', 'slargo', 'giardini', 'giardino', 'gradoni', 'cupa', 'piaggia', 'costa',
  'porta', 'ponte', 'prolungamento', 'prol', 'complanare', 'vallone', 'valle', 'statale', 'provinciale', 'comunale', 'sp', 'ss',
  'sr', 'sc', 'traversale', 'androna', 'carraia', 'alzaia', 'argine', 'isola', 'nucleo', 'agglomerato', 'centro', 'condominio',
  'complesso', 'piano', 'canale', 'campagna', 'lottizzazione', 'lott', 'palazzo', 'palazzina', 'quadrivio', 'trivio', 'bivio',
  'crocevia', 'mura',
]);

/** Premier mot de la rue, sans accents ni ponctuation : « P.za » → « pza », « Loc. » → « loc ». */
function firstStreetWord(street: string): string {
  const word = street.trim().split(/\s+/)[0] ?? '';
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
}

/** Italie seulement : la rue ne commence pas par un type de voie connu (« Roma 10 »). */
function streetTypeMissing(street: string, country: string): boolean {
  if (country.toUpperCase() !== 'IT') return false;
  const trimmed = street.trim();
  // Rue vide ou commençant par un chiffre (« 4 Novembre ») : pas de conclusion fiable.
  if (!trimmed || /^\d/.test(trimmed)) return false;
  return !IT_STREET_TYPES.has(firstStreetWord(trimmed));
}

/**
 * Le complément ne fait que répéter le numéro (« Roma 10 » + « 10 »,
 * « n. 10 », « civico 10 ») : l'étiquette imprime deux fois le numéro.
 */
function houseNumberRepeated(line2: string | null, houseNumber: string): boolean {
  if (!line2 || !houseNumber) return false;
  const key = (value: string) => value.toLowerCase()
    .replace(/^(n|no|nr|num|numero|civico|civ)\b\.?\s*°?\s*/, '')
    .replace(/[^a-z0-9]/g, '');
  return key(line2) !== '' && key(line2) === key(houseNumber);
}

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
  const { street, houseNumber } = splitLine1(line1);
  const country = typeof address.country === 'string' ? address.country.trim() : '';
  if (!houseNumber) codes.push('house_number_missing');
  if (streetTypeMissing(street, country)) codes.push('street_type_missing');
  if (houseNumberRepeated(distinctAddressLine2(line1, address.line2), houseNumber)) codes.push('house_number_repeated');
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
  const streetType = issues.some((issue) => issue.code === 'street_type_missing');
  const ask = missing
    ? ' : demandez le numéro de la maison et confirmez le nom de la rue'
    : streetType ? ' : confirmez le nom complet de la rue, avec le type de voie (Via, Piazza…)' : ' et confirmez son adresse';
  const steps = [
    `Contactez le client par téléphone ou par e-mail (coordonnées dans la commande)${ask}.`,
    'Corrigez l’adresse dans Lepefy : carte « Client & livraison » → « Modifier l’adresse ». Indiquez seulement la rue dans « Rue » et le numéro dans « N° », laissez « Complément » vide s’il ne fait que répéter le numéro, puis enregistrez.',
  ];
  if (providerName) {
    steps.push(`Refaites le brouillon ${providerName} : dans la carte « Expédition ${providerName} », supprimez le brouillon puis recréez-le. L’ancien brouillon garde la mauvaise adresse.`);
  }
  steps.push('Achetez l’étiquette comme d’habitude. Le suivi se met à jour tout seul dans Lepefy.');
  return steps;
}
