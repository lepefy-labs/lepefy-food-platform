// Single catalogue of internal (staff) notification types. The database only
// stores subscriptions (tenant_notification_subscriptions, migration 143):
// adding a type here is enough for the settings UI, the admin API validation,
// the defaults and the health page — no migration.
//
// Client-safe: no server imports.

export type NotificationGroupKey = 'orders' | 'events' | 'reports' | 'account';

/** Tenant module a type depends on; types of a disabled module are hidden. */
export type NotificationModule = 'events';

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
}

export const NOTIFICATION_GROUPS: ReadonlyArray<{ key: NotificationGroupKey; label: string }> = [
  { key: 'orders', label: 'Commandes & paiements' },
  { key: 'events', label: 'Événementiel' },
  { key: 'reports', label: 'Rapports' },
  { key: 'account', label: 'Compte' },
];

export const NOTIFICATION_TYPES = [
  { key: 'card_payment', group: 'orders', label: 'Paiement carte', short: 'Carte', description: 'Un paiement par carte a abouti.', defaultOn: true },
  { key: 'external_payment_pending', group: 'orders', label: 'Paiement externe à vérifier', short: 'À vérifier', description: 'Un client a déclaré un virement ou un paiement externe à confirmer.', defaultOn: true },
  { key: 'order_stock_conflict', group: 'orders', label: 'Conflit de stock', short: 'Stock', description: 'Une commande, réservation ou location dépasse le stock disponible.', defaultOn: false },
  { key: 'event_booking_closed_reports', group: 'events', label: 'Rapports de fin des réservations', short: 'Clôture', description: 'Rapport envoyé à la clôture des réservations d’un événement.', defaultOn: true, module: 'events' },
  { key: 'service_inquiries', group: 'events', label: 'Demandes de devis', short: 'Devis', description: 'Nouvelle demande de devis traiteur ou service.', defaultOn: false, module: 'events' },
  { key: 'rental_reservations', group: 'events', label: 'Réservations matériel', short: 'Location', description: 'Réservation de matériel confirmée ou devis de livraison à établir.', defaultOn: false, module: 'events' },
  { key: 'daily_digest', group: 'reports', label: 'Rapport quotidien (08h)', short: 'Digest', description: 'Résumé quotidien des commandes à traiter.', defaultOn: false },
  { key: 'subscription_billing', group: 'account', label: 'Abonnement Lepefy', short: 'Abonnement', description: 'Rappels avant la suspension automatique et avis de suspension de l’abonnement.', defaultOn: true },
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
  { key: 'operations', label: 'Préparation', description: 'Stock, locations et clôtures', types: ['order_stock_conflict', 'rental_reservations', 'event_booking_closed_reports', 'daily_digest'] },
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
}

export const MAX_SUBSCRIPTION_CHANGES = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates an API payload; returns null when anything is malformed. */
export function parseSubscriptionChanges(body: unknown): NotificationSubscriptionChange[] | null {
  const changes = (body as { changes?: unknown } | null)?.changes;
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_SUBSCRIPTION_CHANGES) return null;
  const parsed: NotificationSubscriptionChange[] = [];
  for (const raw of changes) {
    const change = raw as { recipientId?: unknown; typeKey?: unknown; subscribed?: unknown } | null;
    if (!change || typeof change.recipientId !== 'string' || !UUID_RE.test(change.recipientId)
      || !isNotificationTypeKey(change.typeKey) || typeof change.subscribed !== 'boolean') return null;
    parsed.push({ recipientId: change.recipientId, typeKey: change.typeKey, subscribed: change.subscribed });
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
): NotificationSubscriptionChange[] {
  const has = new Set(current);
  const wants = new Set<string>(target);
  return scope
    .filter((key) => has.has(key) !== wants.has(key))
    .map((key) => ({ recipientId, typeKey: key, subscribed: wants.has(key) }));
}

/** Applies changes locally (optimistic UI), keeping catalogue order. */
export function applySubscriptionChanges(
  recipientId: string,
  current: ReadonlyArray<string>,
  changes: ReadonlyArray<NotificationSubscriptionChange>,
): string[] {
  const next = new Set(current);
  for (const change of changes) {
    if (change.recipientId !== recipientId) continue;
    if (change.subscribed) next.add(change.typeKey); else next.delete(change.typeKey);
  }
  const order = new Map<string, number>(NOTIFICATION_TYPE_KEYS.map((key, index) => [key, index]));
  return Array.from(next).sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}
