/**
 * Checklist di attivazione commerciale di una versione tariffaria.
 *
 * Pura: calcolata nell'admin (schermata di conferma) e ricalcolata dall'API
 * di attivazione, che rifiuta i punti bloccanti e le maggiorazioni «per
 * commande» non riconosciute esplicitamente.
 */

import type { ShippingPackagingProfileRow, ShippingTariffVersionRow } from '@lepefy/types';
import type { ShippingCountryRule } from '@/lib/shipping/resolveCountryRule';
import { cartonsForWeight } from '@/lib/shipping/cartonSuggestion';
import { parseTariffVersion, TARIFF_ERROR_LABELS } from './tariffVersion';

export type ChecklistStatus = 'ok' | 'warning' | 'blocking';

export interface ChecklistItem {
  key:
    | 'migration' | 'version' | 'surcharges_per_parcel' | 'non_deliverable' | 'product_weights'
    | 'cartons' | 'logistics_limit' | 'packaging_cost' | 'test_orders' | 'country_rule';
  status: ChecklistStatus;
  label: string;
  detail: string;
}

export interface ActivationChecklistInput {
  version: ShippingTariffVersionRow;
  migrationReady: boolean;
  missingWeightProducts: number;
  zoneCodes: string[];
  profiles: Array<Pick<ShippingPackagingProfileRow,
    'id' | 'name' | 'box_length_cm' | 'box_width_cm' | 'box_height_cm' | 'active' | 'position'
    | 'suggest_min_weight_g' | 'suggest_max_weight_g'>>;
  countryRule: ShippingCountryRule | null;
  fallback: 'unavailable' | 'provider_cost';
}

const eur = (v: number) => `${v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export function describeCountryRule(rule: ShippingCountryRule | null): string {
  if (!rule) return 'Aucune règle pays active : le prix de la grille s’applique tel quel.';
  const parts: string[] = [];
  if (rule.flat_rate_override != null) parts.push(`forfait fixe ${eur(rule.flat_rate_override)} (remplace la grille)`);
  if (rule.discount_type && rule.discount_value) {
    parts.push(rule.discount_type === 'percentage' ? `remise ${rule.discount_value} %` : `remise ${eur(rule.discount_value)}`);
  }
  if (rule.free_shipping_above != null) parts.push(`livraison offerte dès ${eur(rule.free_shipping_above)} d’articles`);
  return parts.length ? `Règle pays active : ${parts.join(', ')}.` : 'Règle pays active sans effet sur le prix.';
}

export function perOrderSurchargeZones(version: Pick<ShippingTariffVersionRow, 'zone_surcharges'>): string[] {
  return version.zone_surcharges.filter((z) => z.mode === 'per_order' && z.amount_cents > 0).map((z) => z.zone_code);
}

export function buildActivationChecklist(input: ActivationChecklistInput): ChecklistItem[] {
  const { version } = input;
  const items: ChecklistItem[] = [];
  const parsed = parseTariffVersion(version);

  items.push(input.migrationReady
    ? { key: 'migration', status: 'ok', label: 'Migration 125 appliquée', detail: 'Activation, retrait et repli disponibles.' }
    : { key: 'migration', status: 'blocking', label: 'Migration 125 non appliquée', detail: 'Appliquez 125_shipping_tariff_activation.sql avant toute activation.' });

  items.push(parsed.ok
    ? { key: 'version', status: 'ok', label: 'Version cohérente', detail: `${version.bands.length} tranche(s), prix ${version.prices_include_vat ? 'TTC' : 'HT (TVA ajoutée)'}.` }
    : { key: 'version', status: 'blocking', label: 'Version incohérente', detail: parsed.errors.map((e) => TARIFF_ERROR_LABELS[e]).join(' ') });

  const perOrder = perOrderSurchargeZones(version);
  items.push(perOrder.length === 0
    ? { key: 'surcharges_per_parcel', status: 'ok', label: 'Suppléments par colis', detail: version.zone_surcharges.length ? version.zone_surcharges.map((z) => `${z.zone_code} +${eur(z.amount_cents / 100)}/colis`).join(', ') : 'Aucun supplément de zone.' }
    : { key: 'surcharges_per_parcel', status: 'warning', label: 'Suppléments « par commande »', detail: `${perOrder.join(', ')} : le supplément ne sera pas multiplié par le nombre de colis. Confirmation explicite requise.` });

  const extraCustoms = input.zoneCodes.filter((z) => z.startsWith(`${version.country}_`) && z.includes('EXTRA_CUSTOMS'));
  const missingExcluded = extraCustoms.filter((z) => !version.non_deliverable_zones.includes(z));
  items.push(missingExcluded.length === 0
    ? { key: 'non_deliverable', status: 'ok', label: 'Zones non desservies exclues', detail: version.non_deliverable_zones.length ? version.non_deliverable_zones.join(', ') : 'Aucune zone exclue (les territoires extra-douaniers connus restent toujours refusés).' }
    : { key: 'non_deliverable', status: 'warning', label: 'Zone extra-douanière non exclue', detail: `${missingExcluded.join(', ')} n’est pas marquée non livrable dans cette version. Livigno et Campione restent refusés par le code, mais corrigez la version.` });

  items.push(input.missingWeightProducts === 0
    ? { key: 'product_weights', status: 'ok', label: 'Poids produits complets', detail: 'Tous les produits actifs ont un poids.' }
    : { key: 'product_weights', status: 'warning', label: `${input.missingWeightProducts} produit(s) sans poids`, detail: input.fallback === 'provider_cost'
        ? 'Les paniers qui les contiennent seront facturés au devis provider (repli configuré).'
        : 'Les paniers qui les contiennent ne pourront pas être livrés (retrait proposé).' });

  const cartonsOk = cartonsForWeight(1, input.profiles).length > 0 && cartonsForWeight(version.max_parcel_weight_g, input.profiles).length > 0;
  items.push(cartonsOk
    ? { key: 'cartons', status: 'ok', label: 'Cartons configurés', detail: `Un carton suggéré couvre chaque colis jusqu’à ${version.max_parcel_weight_g / 1000} kg : même plan de colis pour la disponibilité Packlink et la préparation.` }
    : { key: 'cartons', status: 'warning', label: 'Cartons incomplets', detail: 'Aucune tranche de suggestion ne couvre tous les poids de colis : le carton par défaut sera utilisé pour vérifier la disponibilité.' });

  items.push(version.logistics_verified_max_weight_g
    ? { key: 'logistics_limit', status: 'ok', label: 'Limite logistique vérifiée', detail: `Au-delà de ${version.logistics_verified_max_weight_g / 1000} kg, seule une réponse Packlink positive autorise la livraison.` }
    : { key: 'logistics_limit', status: 'warning', label: 'Limite logistique non renseignée', detail: 'Aucun poids maximal vérifié : la disponibilité repose uniquement sur Packlink.' });

  items.push({ key: 'packaging_cost', status: 'warning', label: 'Coût réel des emballages', detail: 'Non renseigné dans Lepefy : vérifiez-le avec le fournisseur (seuil de validité de la grille ≈ 1,79 € TTC par colis).' });
  items.push({ key: 'test_orders', status: 'warning', label: 'Commandes de test', detail: 'Après activation, passez une commande test vers le continent et une vers une zone majorée, puis vérifiez le montant payé.' });
  items.push({ key: 'country_rule', status: 'ok', label: 'Règles commerciales', detail: describeCountryRule(input.countryRule) });
  return items;
}

export function activationBlockers(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((i) => i.status === 'blocking');
}
