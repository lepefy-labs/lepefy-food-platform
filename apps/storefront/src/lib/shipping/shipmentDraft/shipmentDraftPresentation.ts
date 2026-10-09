import type { ShipmentCreationStatus } from '@lepefy/types';
import type { ShipmentDraftErrorCode } from '@/lib/shipping/providers/types';

/**
 * Client-safe presentation of the draft provisioning state. The database
 * stores `<code>` or `<code>:<detail>` (detail = missing field names, never
 * personal data or provider payload).
 */

/** Same 8-character reference as the admin order number (`orderNumberFor`: #3F2A91C0). */
export function shipmentOrderReference(orderId: string): string {
  return `LEPEFY-${orderId.slice(0, 8).toUpperCase()}`;
}

const CODES: readonly ShipmentDraftErrorCode[] = [
  'missing_configuration', 'invalid_recipient', 'invalid_parcel', 'provider_timeout', 'provider_unavailable',
  'provider_rejected', 'invalid_provider_response', 'ambiguous_creation',
];

export function shipmentDraftErrorCode(raw: string | null | undefined): ShipmentDraftErrorCode | null {
  const code = raw?.split(':')[0]?.trim() as ShipmentDraftErrorCode | undefined;
  return code && CODES.includes(code) ? code : null;
}

const MESSAGES: Record<ShipmentDraftErrorCode, string> = {
  missing_configuration: 'Configuration Packlink incomplète : vérifiez la clé API et l’entrepôt par défaut dans Packlink PRO.',
  invalid_recipient: 'Coordonnées du destinataire incomplètes',
  invalid_parcel: 'Colis non déterminable',
  provider_timeout: 'Le transporteur n’a pas répondu à temps : le brouillon a peut-être été créé.',
  provider_unavailable: 'Service du transporteur momentanément indisponible.',
  provider_rejected: 'Le transporteur a refusé le brouillon : vérifiez l’adresse et les colis.',
  invalid_provider_response: 'Réponse inattendue du transporteur : le brouillon a peut-être été créé.',
  ambiguous_creation: 'Résultat incertain : le brouillon a peut-être été créé chez le transporteur.',
};

const DETAILS: Record<string, string> = {
  poids: 'poids des produits manquant',
  dimensions: 'dimensions du carton manquantes (Livraison → Emballages)',
  contenu: 'contenu déclaré manquant (Livraison → Expéditions)',
  lecture: 'lecture de la commande impossible',
  interrompu: 'création interrompue',
  'non enregistré': 'brouillon créé mais non enregistré dans Lepefy',
};

export function shipmentDraftErrorMessage(raw: string | null | undefined): string | null {
  const code = shipmentDraftErrorCode(raw);
  if (!code) return raw ? 'Création impossible.' : null;
  const detail = raw!.includes(':') ? raw!.slice(raw!.indexOf(':') + 1).trim() : '';
  if (!detail) return MESSAGES[code].endsWith('.') ? MESSAGES[code] : MESSAGES[code] + '.';
  const readable = DETAILS[detail] ?? (code === 'invalid_recipient' ? `manquant : ${detail}` : detail);
  return `${MESSAGES[code].replace(/\.$/, '')} (${readable}).`;
}

export const SHIPMENT_CREATION_STATUS_LABELS: Record<ShipmentCreationStatus, string> = {
  not_required: 'Aucun brouillon créé',
  pending: 'Création en attente',
  creating: 'Création en cours',
  draft_created: 'Brouillon créé',
  failed: 'Échec de création',
  ambiguous: 'Création incertaine',
};

/** Trigger labels shared by the settings page and the order panel. */
export const SHIPMENT_TRIGGER_LABELS = {
  order_created: 'Dès la création de la commande',
  preparing: 'Au début de la préparation',
  manual: 'Manuellement uniquement',
} as const;
