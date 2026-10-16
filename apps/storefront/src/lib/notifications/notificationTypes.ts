// Single catalogue of internal (staff) notification types. The database only
// stores subscriptions (tenant_notification_subscriptions, migration 143):
// adding a type here is enough for the settings UI, the admin API validation,
// the defaults and the health page — no migration.
//
// Client-safe: no server imports.

export type NotificationGroupKey = 'orders' | 'shipping' | 'events' | 'reports' | 'account';

/** Tenant module a type depends on; types of a disabled module are hidden. */
export type NotificationModule = 'events';

/**
 * Delivery channels (tenant_notification_subscriptions.channel, migrations
 * 143/158). WhatsApp messages leave from the central Lepefy number (Green API)
 * to the recipient's own number, never to customers.
 */
export type NotificationChannel = 'email' | 'whatsapp';
export const NOTIFICATION_CHANNELS: ReadonlyArray<{ key: NotificationChannel; label: string }> = [
  { key: 'email', label: 'Email' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

export function isNotificationChannel(value: unknown): value is NotificationChannel {
  return value === 'email' || value === 'whatsapp';
}

export interface NotificationTypeDefinition {
  key: string;
  group: NotificationGroupKey;
  label: string;
  /** Compact label for dense layouts. */
  short: string;
  description: string;
  /** Pre-checked when adding a recipient. */
  defaultOn: boolean;
  module?: NotificationModule;
  /** Channels this type can be delivered on (email first). */
  channels: ReadonlyArray<NotificationChannel>;
  /**
   * Attribute of another notification rather than a message of its own: a
   * subscriber receives that notification (once, with the indicator) when the
   * attribute applies, e.g. an international order.
   */
  flagOf?: string;
}

export const NOTIFICATION_GROUPS: ReadonlyArray<{ key: NotificationGroupKey; label: string }> = [
  { key: 'orders', label: 'Commandes & paiements' },
  { key: 'shipping', label: 'Expéditions' },
  { key: 'events', label: 'Événementiel' },
  { key: 'reports', label: 'Rapports' },
  { key: 'account', label: 'Compte' },
];

export const NOTIFICATION_TYPES = [
  { key: 'order_created', group: 'orders', label: 'Nouvelle commande', short: 'Commande', description: 'Une commande payée (ou à régler en boutique) vient d’être enregistrée.', defaultOn: true, channels: ['email', 'whatsapp'] },
  { key: 'order_international', group: 'orders', label: 'Commande internationale', short: 'International', description: 'Nouvelle commande à livrer hors du pays de la boutique (même message, signalé).', defaultOn: false, channels: ['email', 'whatsapp'], flagOf: 'order_created' },
  { key: 'order_fresh_products', group: 'orders', label: 'Commande avec produits frais', short: 'Frais', description: 'Nouvelle commande contenant des produits frais ou surgelés (même message, signalé).', defaultOn: false, channels: ['email', 'whatsapp'], flagOf: 'order_created' },
  { key: 'card_payment', group: 'orders', label: 'Paiement carte', short: 'Carte', description: 'Un paiement par carte a abouti.', defaultOn: true, channels: ['email'] },
  { key: 'external_payment_pending', group: 'orders', label: 'Paiement externe à vérifier', short: 'À vérifier', description: 'Un client a déclaré un virement ou un paiement externe à confirmer.', defaultOn: true, channels: ['email', 'whatsapp'] },
  { key: 'order_stock_conflict', group: 'orders', label: 'Conflit de stock', short: 'Stock', description: 'Une commande, réservation ou location dépasse le stock disponible.', defaultOn: false, channels: ['email', 'whatsapp'] },
  { key: 'order_attention_required', group: 'orders', label: 'Commande à vérifier', short: 'Anomalie', description: 'Anomalie sur une commande payée qui demande une intervention.', defaultOn: false, channels: ['email', 'whatsapp'] },
  { key: 'shipment_creation_failed', group: 'shipping', label: 'Échec de création d’expédition', short: 'Échec', description: 'Le brouillon d’expédition n’a pas pu être créé chez le transporteur.', defaultOn: false, channels: ['email', 'whatsapp'] },
  { key: 'shipment_action_required', group: 'shipping', label: 'Expédition à vérifier', short: 'À vérifier', description: 'Résultat incertain, incident transporteur ou préparation manquante sur un colis.', defaultOn: false, channels: ['email', 'whatsapp'] },
  { key: 'shipment_delayed', group: 'shipping', label: 'Livraison en retard', short: 'Retard', description: 'La date de livraison estimée par le transporteur est dépassée.', defaultOn: false, channels: ['email', 'whatsapp'] },
  { key: 'event_reservation_created', group: 'events', label: 'Nouvelle réservation d’événement', short: 'Réservation', description: 'Une réservation payée a été enregistrée pour un événement.', defaultOn: false, module: 'events', channels: ['email', 'whatsapp'] },
  { key: 'event_booking_closed_reports', group: 'events', label: 'Rapports de fin des réservations', short: 'Clôture', description: 'Rapport envoyé à la clôture des réservations d’un événement.', defaultOn: true, module: 'events', channels: ['email'] },
  { key: 'service_inquiries', group: 'events', label: 'Demandes de devis', short: 'Devis', description: 'Nouvelle demande de devis traiteur ou service.', defaultOn: false, module: 'events', channels: ['email', 'whatsapp'] },
  { key: 'rental_reservations', group: 'events', label: 'Réservations matériel', short: 'Location', description: 'Réservation de matériel confirmée ou devis de livraison à établir.', defaultOn: false, module: 'events', channels: ['email', 'whatsapp'] },
  { key: 'daily_digest', group: 'reports', label: 'Rapport quotidien (08h)', short: 'Digest', description: 'Résumé quotidien des commandes à traiter.', defaultOn: false, channels: ['email'] },
  { key: 'subscription_billing', group: 'account', label: 'Abonnement Lepefy', short: 'Abonnement', description: 'Rappels avant la suspension automatique et avis de suspension de l’abonnement.', defaultOn: true, channels: ['email', 'whatsapp'] },
] as const satisfies ReadonlyArray<NotificationTypeDefinition>;

export type NotificationTypeKey = typeof NOTIFICATION_TYPES[number]['key'];

export const NOTIFICATION_TYPE_KEYS: ReadonlyArray<NotificationTypeKey> = NOTIFICATION_TYPES.map((type) => type.key);

const TYPE_KEY_SET = new Set<string>(NOTIFICATION_TYPE_KEYS);

export function isNotificationTypeKey(value: unknown): value is NotificationTypeKey {
  return typeof value === 'string' && TYPE_KEY_SET.has(value);
}

export function getNotificationType(key: NotificationTypeKey): NotificationTypeDefinition {
  return NOTIFICATION_TYPES.find((type) => type.key === key)!;
}

export function typeSupportsChannel(key: string, channel: NotificationChannel): boolean {
  const type = (NOTIFICATION_TYPES as ReadonlyArray<NotificationTypeDefinition>).find((item) => item.key === key);
  return !!type && type.channels.includes(channel);
}

/** Flag types whose subscribers also receive `eventType` when the flag applies. */
export function flagTypeKeys(eventType: string): NotificationTypeKey[] {
  return (NOTIFICATION_TYPES as ReadonlyArray<NotificationTypeDefinition>)
    .filter((type) => type.flagOf === eventType).map((type) => type.key as NotificationTypeKey);
}

/**
 * Recommended starting point (docs/NOTIFICATION_SUBSCRIPTIONS.md): applied only
 * on an explicit admin click, never automatically. WhatsApp still needs a
 * confirmed number before anything is sent.
 */
export const RECOMMENDED_SUBSCRIPTIONS: Readonly<Record<NotificationChannel, ReadonlyArray<NotificationTypeKey>>> = {
  email: ['order_created', 'external_payment_pending', 'order_stock_conflict'],
  whatsapp: ['order_created', 'external_payment_pending', 'order_international', 'order_fresh_products', 'order_stock_conflict'],
};

export interface NotificationTypeContext {
  modules: Record<NotificationModule, boolean>;
}

export function notificationTypeContext(tenant: { events_enabled?: boolean | null }): NotificationTypeContext {
  return { modules: { events: tenant.events_enabled === true } };
}

/** Types relevant to a tenant, in catalogue order. */
export function availableNotificationTypes(context: NotificationTypeContext): NotificationTypeDefinition[] {
  return NOTIFICATION_TYPES.filter((type) => !('module' in type) || context.modules[type.module]);
}

/** Groups with their available types; empty groups are dropped. */
export function groupNotificationTypes(types: ReadonlyArray<NotificationTypeDefinition>) {
  return NOTIFICATION_GROUPS
    .map((group) => ({ ...group, items: types.filter((type) => type.group === group.key) }))
    .filter((group) => group.items.length > 0);
}

export function defaultNotificationTypeKeys(types: ReadonlyArray<NotificationTypeDefinition>): NotificationTypeKey[] {
  return types.filter((type) => type.defaultOn).map((type) => type.key as NotificationTypeKey);
}

// Profiles: one-click starting points, always applied to the available types only.
export interface NotificationPreset {
  key: string;
  label: string;
  description: string;
  types: 'all' | ReadonlyArray<NotificationTypeKey>;
}

export const NOTIFICATION_PRESETS: ReadonlyArray<NotificationPreset> = [
  { key: 'manager', label: 'Gérant', description: 'Toutes les notifications', types: 'all' },
  { key: 'accounting', label: 'Comptabilité', description: 'Paiements, rapport quotidien et abonnement', types: ['card_payment', 'external_payment_pending', 'daily_digest', 'subscription_billing'] },
  { key: 'operations', label: 'Préparation', description: 'Commandes, stock, expéditions, locations et clôtures', types: ['order_created', 'order_international', 'order_fresh_products', 'order_stock_conflict', 'order_attention_required', 'shipment_creation_failed', 'shipment_action_required', 'shipment_delayed', 'rental_reservations', 'event_booking_closed_reports', 'daily_digest'] },
];

export function presetTypeKeys(preset: NotificationPreset, types: ReadonlyArray<NotificationTypeDefinition>): NotificationTypeKey[] {
  const available = types.map((type) => type.key as NotificationTypeKey);
  return preset.types === 'all' ? available : available.filter((key) => preset.types.includes(key));
}

/** The preset matching exactly this selection (on the available types), if any. */
export function matchingPreset(selected: ReadonlyArray<string>, types: ReadonlyArray<NotificationTypeDefinition>): NotificationPreset | null {
  const visible = new Set(types.map((type) => type.key));
  const current = selected.filter((key) => visible.has(key)).sort().join(',');
  return NOTIFICATION_PRESETS.find((preset) => presetTypeKeys(preset, types).slice().sort().join(',') === current) ?? null;
}

// ─── Subscription changes (shared by the admin UI and the API) ──────────────

export interface NotificationSubscriptionChange {
  recipientId: string;
  typeKey: NotificationTypeKey;
  subscribed: boolean;
  /** Omitted = email (payloads written before migration 158). */
  channel?: NotificationChannel;
}

export function changeChannel(change: NotificationSubscriptionChange): NotificationChannel {
  return change.channel ?? 'email';
}

export const MAX_SUBSCRIPTION_CHANGES = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates an API payload; returns null when anything is malformed. */
export function parseSubscriptionChanges(body: unknown): NotificationSubscriptionChange[] | null {
  const changes = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_SUBSCRIPTION_CHANGES) return null;
  const parsed: NotificationSubscriptionChange[] = [];
  for (const raw of changes) {
    const change = raw as { recipientId?: unknown; typeKey?: unknown; subscribed?: unknown; channel?: unknown } | null;
    if (!change || typeof change.recipientId !== 'string' || !UUID_RE.test(change.recipientId)
      || !isNotificationTypeKey(change.typeKey) || typeof change.subscribed !== 'boolean') return null;
    const channel = change.channel === undefined ? 'email' : change.channel;
    // A type is only stored on a channel it can be delivered on.
    if (!isNotificationChannel(channel) || !typeSupportsChannel(change.typeKey, channel)) return null;
    parsed.push({ recipientId: change.recipientId, typeKey: change.typeKey, subscribed: change.subscribed, ...(channel === 'email' ? {} : { channel }) });
  }
  return parsed;
}

/** Validates a list of type keys (e.g. initial subscriptions); null when malformed. */
export function parseTypeKeys(value: unknown): NotificationTypeKey[] | null {
  if (!Array.isArray(value) || !value.every(isNotificationTypeKey)) return null;
  return Array.from(new Set(value));
}

/** Changes turning `current` into `target` for one recipient, limited to `scope`. */
export function diffSubscriptions(
  recipientId: string,
  current: ReadonlyArray<string>,
  target: ReadonlyArray<NotificationTypeKey>,
  scope: ReadonlyArray<NotificationTypeKey>,
  channel: NotificationChannel = 'email',
): NotificationSubscriptionChange[] {
  const has = new Set(current);
  const wants = new Set<string>(target);
  return scope
    .filter((key) => typeSupportsChannel(key, channel) && has.has(key) !== wants.has(key))
    .map((key) => ({ recipientId, typeKey: key, subscribed: wants.has(key), ...(channel === 'email' ? {} : { channel }) }));
}

/** Applies changes of one channel locally (optimistic UI), keeping catalogue order. */
export function applySubscriptionChanges(
  recipientId: string,
  current: ReadonlyArray<string>,
  changes: ReadonlyArray<NotificationSubscriptionChange>,
  channel: NotificationChannel = 'email',
): string[] {
  const next = new Set(current);
  for (const change of changes) {
    if (change.recipientId !== recipientId || changeChannel(change) !== channel) continue;
    if (change.subscribed) next.add(change.typeKey); else next.delete(change.typeKey);
  }
  const order = new Map<string, number>(NOTIFICATION_TYPE_KEYS.map((key, index) => [key, index]));
  return Array.from(next).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}
