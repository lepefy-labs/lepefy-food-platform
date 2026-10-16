// Pure order attributes used by staff notifications (priority, indicators).
// Fresh products come from the catalogue data copied on each order line
// (order_items.storage_type, migration 007), never from product names.

export type StaffPriority = 'normal' | 'high' | 'urgent';

const COUNTRY_ALIASES: Record<string, string> = {
  italia: 'IT', italie: 'IT', italy: 'IT', france: 'FR', francia: 'FR', belgique: 'BE', belgium: 'BE', belgio: 'BE',
  espagne: 'ES', spain: 'ES', spagna: 'ES', españa: 'ES', allemagne: 'DE', germany: 'DE', germania: 'DE', deutschland: 'DE',
  suisse: 'CH', switzerland: 'CH', svizzera: 'CH', luxembourg: 'LU', 'pays-bas': 'NL', netherlands: 'NL', portugal: 'PT',
  autriche: 'AT', austria: 'AT', 'royaume-uni': 'GB', 'united kingdom': 'GB',
};

const COUNTRY_NAMES: Record<string, string> = {
  IT: 'Italie', FR: 'France', BE: 'Belgique', ES: 'Espagne', DE: 'Allemagne', CH: 'Suisse', LU: 'Luxembourg',
  NL: 'Pays-Bas', PT: 'Portugal', AT: 'Autriche', GB: 'Royaume-Uni', IE: 'Irlande', DK: 'Danemark', SE: 'Suède',
  PL: 'Pologne', GR: 'Grèce', MC: 'Monaco', SM: 'Saint-Marin', VA: 'Vatican',
};

/** ISO 3166-1 alpha-2 code from a code or a common name; null when unknown. */
export function countryCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_ALIASES[trimmed.toLowerCase()] ?? null;
}

export function countryLabel(code: string | null): string | null {
  return code ? COUNTRY_NAMES[code] ?? code : null;
}

/** true/false only when both countries are known; null otherwise (never guessed). */
export function isInternationalDestination(destination: unknown, shopCountry: unknown): boolean | null {
  const to = countryCode(destination);
  const from = countryCode(shopCountry);
  if (!to || !from) return null;
  return to !== from;
}

export interface OrderLineSignal {
  quantity: number;
  storage_type?: string | null;
}

export function coldChainKinds(lines: ReadonlyArray<OrderLineSignal>): { fresh: boolean; frozen: boolean } {
  return {
    fresh: lines.some((line) => line.storage_type === 'fresh'),
    frozen: lines.some((line) => line.storage_type === 'frozen'),
  };
}

export function itemCount(lines: ReadonlyArray<OrderLineSignal>): number {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? Math.max(0, Math.trunc(line.quantity)) : 0), 0);
}

/** Priority of a new order: cold chain or international delivery first. */
export function newOrderPriority(input: { international: boolean | null; fresh: boolean; frozen: boolean; fulfillmentType: string }): StaffPriority {
  if (input.fulfillmentType === 'delivery' && (input.fresh || input.frozen)) return 'high';
  if (input.international === true) return 'high';
  if (input.fresh || input.frozen) return 'high';
  return 'normal';
}

/** « Marie K. » from « Marie Koné » — no full name in a phone notification. */
export function customerShortName(fullName: string | null | undefined): string | null {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0]!.slice(0, 40);
  const last = parts.length > 1 ? parts[parts.length - 1]! : '';
  return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
}

export const PRIORITY_LABEL: Record<StaffPriority, string | null> = {
  urgent: '🔴 URGENT',
  high: '🟠 PRIORITAIRE',
  normal: null,
};
