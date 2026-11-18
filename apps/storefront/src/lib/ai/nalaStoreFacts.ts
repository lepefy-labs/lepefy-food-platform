import { createHash } from 'node:crypto';
import type { Tenant } from '@lepefy/types';
import type { createServiceClient } from '@/lib/supabase/server';
import { countryLabel } from '@/lib/address/addressRules';
import { phoneCountries } from '@/lib/address/countries';
import { readDigitalCardSettings } from '@/lib/card/digitalCardSettings';
import { formatShortDate, hasAnyOpening, localDate, upcomingClosures, type Closure } from '@/lib/card/openingHours';
import { LEGACY_DELIVERY_COUNTRIES, destinationCountryList } from '@/lib/shipping/geo/geoPolicy';
import { loadConfiguredCountries, loadGeoPolicy } from '@/lib/shipping/geo/geoPolicyServer';
import { APP_INSTALL_PATH } from '@/lib/pwa/appInstall';

/**
 * Faits du magasin pour Nala, lus des mêmes sources que le reste de la
 * boutique (grille d'horaires → `click_collect_hours`, fermetures de la carte
 * digitale, politique géographique du checkout, page /app). Ils priment sur le
 * contexte privé écrit à la main, qui peut vieillir (ex. horaires ou pays de
 * livraison recopiés une fois et jamais mis à jour).
 */

type ServiceClient = ReturnType<typeof createServiceClient>;

const LIST_COUNTRIES_MAX = 30;

export interface NalaStoreFactsInput {
  hoursText: string | null;
  closures: Array<Pick<Closure, 'from' | 'to' | 'label'>>;
  pickupEnabled: boolean;
  pickupAddress: string | null;
  /** Codes ISO2 où la boutique accepte une adresse de livraison ; null = inconnu. */
  deliveryCountries: string[] | null;
  appInstallUrl: string | null;
}

function countryNames(codes: string[]): string {
  return codes.map((code) => countryLabel(code)).join(', ');
}

/** « le 24 déc. (Noël) ; du 10 août au 24 août (congés) » / « il 24 dic. … », null sans fermeture. */
export function closuresSentence(closures: NalaStoreFactsInput['closures'], lang: 'fr' | 'it' = 'fr'): string | null {
  if (closures.length === 0) return null;
  const [single, from, to] = lang === 'it' ? ['il', 'dal', 'al'] : ['le', 'du', 'au'];
  return closures.map((c) => {
    const range = c.from === c.to
      ? `${single} ${formatShortDate(c.from, lang)}`
      : `${from} ${formatShortDate(c.from, lang)} ${to} ${formatShortDate(c.to, lang)}`;
    return `${range}${c.label?.trim() ? ` (${c.label.trim()})` : ''}`;
  }).join(' ; ');
}

/** Texte des faits (français, comme le prompt). Pur : testable sans base. */
export function buildNalaStoreFactsText(input: NalaStoreFactsInput): string {
  const lines: string[] = [];
  lines.push(input.hoursText
    ? `- Horaires d'ouverture de la boutique : ${input.hoursText}. Ce sont les seuls horaires valables, y compris pour le dimanche.`
    : "- Horaires d'ouverture : non communiqués. Ne donne aucun horaire, propose de contacter la boutique.");
  const closures = closuresSentence(input.closures);
  if (closures) lines.push(`- Fermetures exceptionnelles à venir : ${closures}.`);
  lines.push(input.pickupEnabled
    ? `- Retrait en boutique (Click & Collect) : possible${input.pickupAddress ? `, à l'adresse ${input.pickupAddress}` : ''}.`
    : '- Retrait en boutique : non proposé en ligne.');
  if (input.deliveryCountries && input.deliveryCountries.length > 0) {
    const coverage = input.deliveryCountries.length <= LIST_COUNTRIES_MAX
      ? `- Pays de livraison acceptés au paiement : ${countryNames(input.deliveryCountries)}. Pour tout autre pays, dis que la livraison en ligne n'y est pas proposée.`
      // Liste trop longue pour être citée : jamais un nombre de pays, qui sonne faux au client.
      : '- Pays de livraison : tous les pays desservis par notre transporteur. Ne cite jamais un nombre de pays ; dis simplement que la boutique livre dans ce pays et que le transporteur confirme la destination au paiement.';
    lines.push(`${coverage} Le prix exact et la confirmation viennent du calcul fait au paiement avec l'adresse complète ; si le code postal n'est pas reconnu, le client doit le vérifier.`);
  }
  if (input.appInstallUrl) {
    lines.push(`- Application : la boutique s'installe gratuitement sur le téléphone, sans passer par un store (icône sur l'écran d'accueil). Les étapes sont sur ${input.appInstallUrl}. Ne dis jamais qu'il n'y a rien à installer.`);
  }
  return lines.join('\n');
}

/** Empreinte des faits : une réponse mémorisée n'est réutilisée que si elle n'a pas changé. */
export function nalaStoreFactsRevision(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export interface NalaStoreFacts {
  text: string;
  revision: string;
  /** Pour les réponses directes (sans IA) : fermetures à venir et page d'installation. */
  closures: Closure[];
  appInstallUrl: string | null;
}

async function loadClosures(supabase: ServiceClient, tenantId: string, now: Date): Promise<Closure[]> {
  try {
    const state = await readDigitalCardSettings(supabase, tenantId);
    const hours = state.status === 'ok' ? state.config.opening_hours : null;
    if (!hasAnyOpening(hours)) return [];
    const today = localDate(now, hours.timezone);
    const horizon = new Date(now.getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    return upcomingClosures(hours, today).filter((c) => c.from <= horizon);
  } catch {
    return [];
  }
}

async function loadDeliveryCountries(supabase: ServiceClient, tenant: Pick<Tenant, 'id' | 'country'>): Promise<string[] | null> {
  try {
    const [policy, configured] = await Promise.all([loadGeoPolicy(supabase, tenant.id), loadConfiguredCountries(supabase, tenant.id)]);
    // Même règle que la page checkout : sans politique enregistrée, liste historique.
    if (policy.version === 0) return [...LEGACY_DELIVERY_COUNTRIES];
    const catalog = phoneCountries('fr', [tenant.country ?? '']).map((c) => c.code);
    const list = destinationCountryList(policy, configured, catalog);
    return list.length > 0 ? list : [...LEGACY_DELIVERY_COUNTRIES];
  } catch {
    return null;
  }
}

/** Ne lève jamais : une source illisible est simplement omise. */
export async function loadNalaStoreFacts(params: {
  supabase: ServiceClient;
  tenant: Tenant;
  locale: string;
  now?: Date;
}): Promise<NalaStoreFacts> {
  const { tenant } = params;
  const now = params.now ?? new Date();
  const italian = params.locale.toLowerCase().startsWith('it');
  const hoursText = (italian ? tenant.click_collect_hours_it ?? tenant.click_collect_hours : tenant.click_collect_hours ?? tenant.click_collect_hours_it)?.trim() || null;
  const [closures, deliveryCountries] = await Promise.all([
    loadClosures(params.supabase, tenant.id, now),
    loadDeliveryCountries(params.supabase, tenant),
  ]);
  const storefront = tenant.storefront_url && /^https?:\/\//.test(tenant.storefront_url) ? tenant.storefront_url.replace(/\/+$/, '') : null;
  const appInstallUrl = storefront ? `${storefront}${APP_INSTALL_PATH}` : null;
  const text = buildNalaStoreFactsText({
    hoursText,
    closures,
    pickupEnabled: Boolean(tenant.click_collect_enabled),
    pickupAddress: tenant.click_collect_address?.trim() || null,
    deliveryCountries,
    appInstallUrl,
  });
  return { text, revision: nalaStoreFactsRevision(text), closures, appInstallUrl };
}
