/**
 * Traduzione degli errori delle RPC Gestion (raise exception '<codice>[:dettaglio]')
 * in risposte HTTP con messaggio francese. Funzione pura.
 */

const MESSAGES: Record<string, [number, string]> = {
  request_key_required: [400, 'Requête invalide. Rechargez la page et réessayez.'],
  request_key_conflict: [409, 'Cette opération a déjà été enregistrée avec des données différentes.'],
  tenant_not_found: [404, 'Boutique introuvable.'],
  field_too_long: [400, 'Un champ dépasse la longueur autorisée.'],
  supplier_name_required: [400, 'Le nom du fournisseur est obligatoire.'],
  supplier_not_found: [404, 'Fournisseur introuvable ou inactif.'],
  items_required: [400, 'La liste des articles est invalide.'],
  too_many_items: [400, 'Un achat ne peut pas dépasser 200 articles.'],
  invalid_quantity: [400, 'Quantité invalide.'],
  invalid_unit_cost: [400, 'Coût unitaire invalide.'],
  product_not_found: [404, 'Produit introuvable dans votre catalogue.'],
  item_description_required: [400, 'Chaque article doit avoir une description.'],
  invalid_additional_costs: [400, 'Frais supplémentaires invalides.'],
  invalid_initial_status: [400, 'Statut initial invalide.'],
  purchase_items_required: [400, 'Ajoutez au moins un article avant de passer la commande.'],
  purchase_not_found: [404, 'Achat introuvable.'],
  purchase_not_editable: [409, 'Cet achat ne peut plus être modifié.'],
  purchase_has_receipts: [409, 'Cet achat a déjà des réceptions enregistrées.'],
  total_below_allocated: [409, 'Le total ne peut pas être inférieur aux paiements déjà affectés.'],
  invalid_target_status: [400, 'Statut demandé invalide.'],
  invalid_transition: [409, 'Ce changement de statut n\'est pas possible.'],
  purchase_has_allocations: [409, 'Des paiements sont affectés à cet achat : retirez-les avant de l\'annuler.'],
  purchase_not_receivable: [409, 'Cet achat ne peut pas recevoir de marchandise (brouillon, déjà reçu ou annulé).'],
  receipt_items_required: [400, 'Indiquez au moins une quantité reçue.'],
  received_at_in_future: [400, 'La date de réception ne peut pas être dans le futur.'],
  purchase_item_not_found: [404, 'Article de l\'achat introuvable.'],
  quantity_exceeds_remaining: [409, 'La quantité reçue dépasse le reste à recevoir.'],
  reason_required: [400, 'Un motif est obligatoire.'],
  receipt_not_found: [404, 'Réception introuvable.'],
  insufficient_stock_for_reversal: [409, 'Stock insuffisant pour annuler cette réception : la marchandise a déjà été vendue.'],
  stock_would_be_negative: [409, 'Le stock ne peut pas devenir négatif.'],
  invalid_amount: [400, 'Montant invalide (positif, 2 décimales au plus).'],
  payment_voided: [409, 'Ce paiement est annulé.'],
  purchase_cancelled: [409, 'Cet achat est annulé.'],
  supplier_mismatch: [409, 'Le paiement et l\'achat concernent des fournisseurs différents.'],
  currency_mismatch: [409, 'Le paiement et l\'achat sont dans des devises différentes.'],
  payment_over_allocated: [409, 'Le montant affecté dépasse le montant du paiement.'],
  purchase_over_allocated: [409, 'Le montant affecté dépasse le reste à payer de l\'achat.'],
  invalid_method: [400, 'Mode de paiement invalide.'],
  invalid_beneficiary_type: [400, 'Type de bénéficiaire invalide.'],
  payment_date_in_future: [400, 'La date de paiement ne peut pas être dans le futur.'],
  beneficiary_name_required: [400, 'Le nom du bénéficiaire est obligatoire pour un paiement à un tiers.'],
  invalid_allocations: [400, 'Affectations invalides.'],
  payment_not_found: [404, 'Paiement introuvable.'],
  allocation_not_found: [404, 'Affectation introuvable.'],
  document_entity_not_found: [404, 'Élément introuvable pour ce document.'],
  quantity_precision: [400, 'Quantité trop précise : 3 décimales au plus (ex. 12,375).'],
  invalid_unit: [400, 'Unité d\'achat invalide.'],
  invalid_conversion: [400, 'Conversion vers le stock invalide (nombre positif, 6 décimales au plus).'],
  stock_units_not_integer: [409, 'La quantité reçue convertie en unités de stock doit être un nombre entier. Vérifiez la quantité ou la conversion.'],
  invalid_payment_terms: [400, 'Conditions de paiement invalides (0 à 3650 jours).'],
};

export interface GestionErrorInfo {
  status: number;
  code: string;
  message: string;
}

export function gestionRpcError(error: { message?: string | null; code?: string | null } | null | undefined): GestionErrorInfo {
  const raw = (error?.message ?? '').trim();
  const code = raw.split(':')[0]?.trim() ?? '';
  const known = MESSAGES[code];
  if (known) return { status: known[0], code, message: known[1] };
  if (error?.code === '23505') return { status: 409, code: 'duplicate', message: 'Cette opération a déjà été enregistrée.' };
  if (error?.code === '23503') return { status: 400, code: 'invalid_reference', message: 'Référence invalide pour cette boutique.' };
  if (error?.code === '23514' || error?.code === '22P02' || error?.code === '22007' || error?.code === '22008') {
    return { status: 400, code: 'invalid_input', message: 'Données invalides.' };
  }
  return { status: 500, code: 'unexpected', message: 'Erreur inattendue. Réessayez.' };
}
