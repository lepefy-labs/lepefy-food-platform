/**
 * Catalogue des motifs d'échec / d'exclusion d'un scénario de campagne —
 * pur, partagé serveur (remesure) et UI (diagnostic). `resample` indique si
 * une remesure a une chance d'aboutir : un refus déterministe (CAP refusé par
 * Packlink, aucun service éligible, profil supprimé) n'est pas remesuré.
 */
export type ErrorReasonCode =
  | 'provider_error'
  | 'provider_rejected'
  | 'provider_rejected_known_destination'
  | 'legacy_packlink_error'
  | 'no_service'
  | 'no_eligible_service'
  | 'persistence_error'
  | 'chosen_observation_missing'
  | 'packaging_profile_not_found'
  | 'unexpected_error'
  | 'reused_other_postal_code'
  | 'reused_incompatible'
  | 'observation_missing'
  | 'unverifiable';

export interface ErrorReasonInfo {
  label: string;
  explanation: string;
  /** 'incident' : exécution/infrastructure ; 'data' : propriété du scénario ; 'history' : donnée antérieure à V1E. */
  kind: 'incident' | 'data' | 'history';
  resample: boolean;
}

export const ERROR_REASONS: Record<ErrorReasonCode, ErrorReasonInfo> = {
  provider_error: {
    label: 'Incident Packlink',
    explanation: 'Packlink indisponible, délai dépassé, limite de débit ou credential refusé (5xx, 429, 401/403). Transitoire : une remesure peut aboutir.',
    kind: 'incident', resample: true,
  },
  legacy_packlink_error: {
    label: 'Erreur Packlink (antérieure au diagnostic détaillé)',
    explanation: 'Enregistrée avant la distinction incident / refus : peut être une panne ou un CAP refusé. La remesure tranchera — un CAP refusé est arrêté après deux poids.',
    kind: 'history', resample: true,
  },
  provider_rejected: {
    label: 'CAP refusé par Packlink',
    explanation: 'Packlink répond « Bad Request » (400/404/422) pour cette destination — souvent un CAP générique d\'avant réforme encore présent dans GeoNames (ex. 40100, 41100). Remplacer par les CAP en vigueur.',
    kind: 'data', resample: false,
  },
  provider_rejected_known_destination: {
    label: 'CAP refusé par Packlink (sans nouvel appel)',
    explanation: 'Le CAP a déjà été refusé pour au moins deux poids : le scénario est clos sans appel Packlink supplémentaire.',
    kind: 'data', resample: false,
  },
  no_service: {
    label: 'Aucun service renvoyé',
    explanation: 'Packlink a répondu sans aucun service pour cette destination et ce colis.',
    kind: 'data', resample: true,
  },
  no_eligible_service: {
    label: 'Aucun service éligible',
    explanation: 'Seuls des services exclus (point relais, B2B) ont été proposés : aucun devis livraison à domicile exploitable. Les offres sont conservées pour analyse.',
    kind: 'data', resample: false,
  },
  persistence_error: {
    label: 'Erreur d\'enregistrement',
    explanation: 'Devis reçu mais écriture impossible en base. Transitoire.',
    kind: 'incident', resample: true,
  },
  chosen_observation_missing: {
    label: 'Observation choisie introuvable',
    explanation: 'Offres enregistrées mais le service retenu n\'a pas été retrouvé. Transitoire.',
    kind: 'incident', resample: true,
  },
  packaging_profile_not_found: {
    label: 'Profil d\'emballage supprimé',
    explanation: 'Le profil du scénario n\'existe plus : impossible de construire la demande.',
    kind: 'data', resample: false,
  },
  unexpected_error: {
    label: 'Erreur inattendue',
    explanation: 'Exception pendant le traitement. Voir le message d\'exemple et les logs serveur.',
    kind: 'incident', resample: true,
  },
  reused_other_postal_code: {
    label: 'Réemploi d\'un autre CAP (historique)',
    explanation: 'Avant V1E, le devis d\'un autre CAP de la même zone a été réutilisé. Non compté comme couverture.',
    kind: 'history', resample: true,
  },
  reused_incompatible: {
    label: 'Réemploi divergent (historique)',
    explanation: 'Réemploi d\'un devis au poids, aux colis ou aux dimensions différents, ou périmé. Non compté comme couverture.',
    kind: 'history', resample: true,
  },
  observation_missing: {
    label: 'Observation introuvable',
    explanation: 'Aucune observation rattachée ou retrouvée pour ce tenant.',
    kind: 'history', resample: true,
  },
  unverifiable: {
    label: 'Non vérifiable',
    explanation: 'Cohérence impossible à prouver (observation non éligible, d\'une autre campagne ou d\'un autre profil).',
    kind: 'history', resample: true,
  },
};

const KNOWN_ITEM_ERRORS = new Set<ErrorReasonCode>([
  'provider_error', 'provider_rejected', 'provider_rejected_known_destination', 'no_service',
  'no_eligible_service', 'chosen_observation_missing', 'packaging_profile_not_found',
]);

/** Normalise le texte `error` d'un item `failed` en code de motif. */
export function errorReasonFromItemError(error: string | null | undefined): ErrorReasonCode {
  const value = (error ?? '').trim();
  if (KNOWN_ITEM_ERRORS.has(value as ErrorReasonCode)) return value as ErrorReasonCode;
  if (value === 'packlink_error') return 'legacy_packlink_error';
  if (value.startsWith('persistence_error')) return 'persistence_error';
  return 'unexpected_error';
}

export function shouldResampleReason(code: ErrorReasonCode): boolean {
  return ERROR_REASONS[code].resample;
}
