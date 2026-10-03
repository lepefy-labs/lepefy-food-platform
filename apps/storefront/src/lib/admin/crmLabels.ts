// French labels for raw CRM values (Admin → Clients). Pure, client-safe.
// Unknown values are returned as received: never an invented translation.

const CUSTOMER_SOURCES: Record<string, string> = {
  signup: 'Inscription',
  guest_checkout: 'Commande invité',
  admin: 'Saisie équipe',
  in_store: 'Boutique',
  event: 'Événement',
  import: 'Import',
  other: 'Autre',
};

const CONSENT_SOURCES: Record<string, string> = {
  signup: 'Inscription',
  checkout: 'Paiement en ligne',
  reconsent_gate: 'Mise à jour des conditions',
  cookie_banner: 'Bandeau cookies',
  account_settings: 'Paramètres du compte',
};

const POINT_TYPES: Record<string, string> = {
  PURCHASE_EARNED: 'Achat en ligne',
  IN_STORE_PURCHASE_EARNED: 'Achat en boutique',
  REFERRAL_EARNED: 'Parrainage',
  SIGNUP_BONUS: 'Bonus d’inscription',
  REDEEMED: 'Utilisés',
  EXPIRED: 'Expirés',
  REVERSED: 'Annulés',
};

const CAMPAIGN_RECIPIENT_STATUSES: Record<string, string> = {
  pending: 'En attente',
  processing: 'En cours',
  sent: 'Envoyée',
  delivered: 'Délivrée',
  opened: 'Ouverte',
  clicked: 'Cliquée',
  converted: 'Convertie',
  skipped: 'Ignorée',
  failed: 'Échec',
};

const CAMPAIGN_CHANNELS: Record<string, string> = { email: 'E-mail', sms: 'SMS', whatsapp: 'WhatsApp', push: 'Notification' };

const RESERVATION_STATUSES: Record<string, string> = {
  confirmed: 'Confirmée',
  pending: 'En attente',
  cancelled: 'Annulée',
  refunded: 'Remboursée',
};

const pick = (map: Record<string, string>) => (value: string | null | undefined): string => (value ? map[value] ?? value : '—');

export const customerSourceLabel = pick(CUSTOMER_SOURCES);
export const consentSourceLabel = pick(CONSENT_SOURCES);
export const pointTypeLabel = pick(POINT_TYPES);
export const campaignRecipientStatusLabel = pick(CAMPAIGN_RECIPIENT_STATUSES);
export const campaignChannelLabel = pick(CAMPAIGN_CHANNELS);
export const reservationStatusLabel = pick(RESERVATION_STATUSES);

/** Options of the "source" filter, in display order. */
export const CUSTOMER_SOURCE_OPTIONS = Object.entries(CUSTOMER_SOURCES).map(([value, label]) => ({ value, label }));

// ─── List sort (query string) ──────────────────────────────────────────────

export type CustomerSortKey = 'last_activity' | 'spent' | 'orders' | 'name' | 'created';

export const CUSTOMER_SORT_OPTIONS: ReadonlyArray<{ key: CustomerSortKey; label: string; direction: 'asc' | 'desc' }> = [
  { key: 'last_activity', label: 'Dernière activité', direction: 'desc' },
  { key: 'spent', label: 'Plus dépensé', direction: 'desc' },
  { key: 'orders', label: 'Plus de commandes', direction: 'desc' },
  { key: 'name', label: 'Nom (A → Z)', direction: 'asc' },
  { key: 'created', label: 'Plus récents', direction: 'desc' },
];

/** Sort and direction from the query string; unknown values fall back to "last activity". */
export function parseCustomerSort(sort: string | null | undefined): { sort: CustomerSortKey; direction: 'asc' | 'desc' } {
  const option = CUSTOMER_SORT_OPTIONS.find((entry) => entry.key === sort) ?? CUSTOMER_SORT_OPTIONS[0]!;
  return { sort: option.key, direction: option.direction };
}
