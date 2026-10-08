/**
 * Errori delle RPC 149 (raise exception '<codice>[:dettaglio]') e del connettore
 * → messaggio francese per la console platform. Funzione pura.
 */

const MESSAGES: Record<string, [number, string]> = {
  request_key_required: [400, 'Requête invalide. Rechargez la page et réessayez.'],
  source_not_found: [404, 'Source introuvable.'],
  source_archived: [409, 'Cette source est archivée.'],
  item_not_found: [404, 'Produit WhatsApp introuvable.'],
  item_dismissed: [409, 'Ce produit est écarté : restaurez-le avant de l’appliquer.'],
  items_must_be_array: [400, 'Lecture invalide.'],
  too_many_items: [400, 'Lecture trop volumineuse (500 produits maximum).'],
  provider_product_id_required: [502, 'Réponse du fournisseur incomplète (produit sans identifiant).'],
  content_hash_invalid: [500, 'Erreur interne de lecture.'],
  consent_required: [409, 'Consentement du vendeur non enregistré : enregistrez-le sur la source avant d’appliquer un produit.'],
  mode_invalid: [400, 'Action invalide.'],
  fields_must_be_object: [400, 'Champs invalides.'],
  field_not_allowed: [400, 'Champ non modifiable depuis l’import.'],
  field_too_long: [400, 'Un champ dépasse la longueur autorisée.'],
  invalid_integer: [400, 'Valeur entière invalide.'],
  out_of_range: [400, 'Valeur hors limites (minimum et incrément : entiers de 1 à 10 000).'],
  price_invalid: [400, 'Prix invalide (positif, 2 décimales au plus).'],
  price_required: [400, 'Le prix unitaire est obligatoire pour créer le produit.'],
  name_required: [400, 'Le nom est obligatoire.'],
  category_not_found: [400, 'Catégorie introuvable pour ce tenant.'],
  product_required: [400, 'Choisissez le produit Lepefy à mettre à jour.'],
  product_not_found: [404, 'Produit Lepefy introuvable pour ce tenant.'],
  item_already_linked: [409, 'Ce produit WhatsApp est déjà lié : mettez à jour le produit Lepefy existant.'],
  product_already_linked: [409, 'Ce produit Lepefy est déjà lié à un autre produit WhatsApp.'],
  product_not_linked: [409, 'Le produit WhatsApp n’est pas lié à ce produit Lepefy.'],
  images_must_be_array: [400, 'Images invalides.'],
  image_url_invalid: [400, 'Chemin d’image invalide.'],
  action_invalid: [400, 'Action invalide.'],
};

export interface ExternalCatalogErrorInfo {
  status: number;
  code: string;
  message: string;
}

export function externalCatalogRpcError(error: { message?: string | null; code?: string | null } | null | undefined): ExternalCatalogErrorInfo {
  const raw = (error?.message ?? '').trim();
  const code = raw.split(':')[0]?.trim() ?? '';
  const known = MESSAGES[code];
  if (known) return { status: known[0], code, message: known[1] };
  if (error?.code === '42P01' || error?.code === 'PGRST202' || error?.code === 'PGRST205') {
    return { status: 503, code: 'migration_missing', message: 'Module indisponible : la migration 149 n’est pas appliquée.' };
  }
  if (error?.code === '23505') return { status: 409, code: 'duplicate', message: 'Cette source existe déjà pour ce tenant.' };
  if (error?.code === '23503') return { status: 400, code: 'invalid_reference', message: 'Référence invalide pour ce tenant.' };
  if (error?.code === '23514' || error?.code === '22P02') return { status: 400, code: 'invalid_input', message: 'Données invalides.' };
  return { status: 500, code: 'unexpected', message: 'Erreur inattendue. Réessayez.' };
}

/** Errori del connettore (ExternalCatalogError.code) → messaggio per la console. */
export const PROVIDER_ERROR_MESSAGES: Record<string, string> = {
  AUTH_MISSING: 'GREEN-API n’est pas configuré sur ce déploiement (GREEN_API_URL, GREEN_API_INSTANCE_ID, GREEN_API_TOKEN).',
  AUTH_INVALID: 'GREEN-API a refusé les identifiants de l’instance.',
  CONFIG_INVALID: 'Configuration GREEN-API invalide.',
  INSTANCE_NOT_AUTHORIZED: 'L’instance GREEN-API n’est plus connectée à WhatsApp : rescannez le QR code dans la console GREEN-API.',
  INSTANCE_UNAVAILABLE: 'L’instance GREEN-API est indisponible (démarrage, blocage ou suspension).',
  SOURCE_INVALID: 'Lien ou numéro du vendeur invalide.',
  CATALOG_UNAVAILABLE: 'Catalogue introuvable pour ce numéro : vérifiez le numéro WhatsApp du vendeur.',
  RATE_LIMITED: 'WhatsApp limite temporairement les lectures de catalogue. Réessayez plus tard.',
  QUOTA_EXCEEDED: 'Quota du forfait GREEN-API épuisé.',
  TIMEOUT: 'GREEN-API ne répond pas. Réessayez.',
  NETWORK: 'Erreur réseau vers GREEN-API.',
  PROVIDER_ERROR: 'Erreur du fournisseur GREEN-API.',
  UNEXPECTED_RESPONSE: 'Réponse inattendue de GREEN-API.',
};
