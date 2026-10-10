/**
 * Catalogo del Journal d'activité (docs/ADMIN_ACTIVITY_AUDIT.md §4).
 *
 * Metà TS del catalogo: etichette francesi, modulo, permesso di lettura e link
 * della risorsa. La metà SQL (`audit_event_types`, migration 153) è la FK che
 * rifiuta un tipo sconosciuto; `tests/unit/activityAudit.spec.ts` verifica che le
 * due metà coincidano. Importabile dai Client Components (nessuna dipendenza server).
 *
 * Aggiungere un evento: una voce in AUDIT_EVENT_TYPES + una riga nell'insert
 * di una migration (`audit_event_types`). Mai una stringa libera.
 */

export type AuditCategory = 'activity' | 'automation' | 'security';
export type AuditSeverity = 'info' | 'notice' | 'warning' | 'critical';
export type AuditOutcome = 'success' | 'failure' | 'pending' | 'unknown';
export type AuditActorKind = 'admin' | 'platform_owner' | 'customer' | 'system' | 'provider' | 'automation' | 'unknown';
export type AuditRetentionClass = 'business' | 'technical' | 'security';

export interface AuditEventTypeDefinition {
  label: string;
  module: string;
  category: AuditCategory;
  severity: AuditSeverity;
  retention: AuditRetentionClass;
}

/** Native events (audit_events). Keep in sync with migration 153 §1. */
export const AUDIT_EVENT_TYPES = {
  'orders.order.created': { label: 'Commande créée', module: 'orders', category: 'activity', severity: 'info', retention: 'business' },
  'orders.order.status_changed': { label: 'Statut de la commande modifié', module: 'orders', category: 'activity', severity: 'info', retention: 'business' },
  'orders.order.tracking_updated': { label: 'Suivi modifié', module: 'orders', category: 'activity', severity: 'info', retention: 'business' },
  'orders.order.updated': { label: 'Commande modifiée', module: 'orders', category: 'activity', severity: 'info', retention: 'business' },
  'payments.payment.manually_confirmed': { label: 'Paiement confirmé manuellement', module: 'payments', category: 'activity', severity: 'notice', retention: 'business' },
  'payments.payment.status_changed': { label: 'Statut du paiement modifié', module: 'payments', category: 'activity', severity: 'info', retention: 'business' },
  'shipping.shipment.draft_requested': { label: 'Brouillon d’expédition demandé', module: 'shipping', category: 'automation', severity: 'info', retention: 'technical' },
  'shipping.shipment.draft_created': { label: 'Brouillon d’expédition créé', module: 'shipping', category: 'automation', severity: 'info', retention: 'business' },
  'shipping.shipment.creation_failed': { label: 'Création d’expédition échouée', module: 'shipping', category: 'automation', severity: 'warning', retention: 'business' },
  'shipping.shipment.creation_ambiguous': { label: 'Création d’expédition à vérifier', module: 'shipping', category: 'automation', severity: 'critical', retention: 'business' },
  'shipping.shipment.draft_detached': { label: 'Brouillon d’expédition détaché', module: 'shipping', category: 'automation', severity: 'notice', retention: 'business' },
  'shipping.shipment.status_changed': { label: 'Statut transporteur modifié', module: 'shipping', category: 'automation', severity: 'info', retention: 'technical' },
  'shipping.tracking.sync_failed': { label: 'Synchronisation du suivi échouée', module: 'shipping', category: 'automation', severity: 'warning', retention: 'technical' },
  'catalog.product.created': { label: 'Produit créé', module: 'catalog', category: 'activity', severity: 'info', retention: 'business' },
  'catalog.product.deleted': { label: 'Produit supprimé', module: 'catalog', category: 'activity', severity: 'notice', retention: 'business' },
  'catalog.product.price_updated': { label: 'Prix modifié', module: 'catalog', category: 'activity', severity: 'info', retention: 'business' },
  'catalog.product.availability_changed': { label: 'Disponibilité modifiée', module: 'catalog', category: 'activity', severity: 'info', retention: 'business' },
  'catalog.product.quantity_rule_changed': { label: 'Règle de vente modifiée', module: 'catalog', category: 'activity', severity: 'info', retention: 'business' },
  'catalog.product.stock_adjusted': { label: 'Stock ajusté', module: 'catalog', category: 'activity', severity: 'info', retention: 'business' },
  'catalog.product.updated': { label: 'Fiche produit modifiée', module: 'catalog', category: 'activity', severity: 'info', retention: 'business' },
  'customers.customer.created': { label: 'Client créé', module: 'customers', category: 'activity', severity: 'info', retention: 'business' },
  'customers.customer.updated': { label: 'Client modifié', module: 'customers', category: 'activity', severity: 'info', retention: 'business' },
  'admin.settings.updated': { label: 'Paramètres de la boutique modifiés', module: 'admin', category: 'activity', severity: 'notice', retention: 'business' },
  'admin.feature_flag.changed': { label: 'Fonctionnalité activée ou désactivée', module: 'admin', category: 'activity', severity: 'notice', retention: 'business' },
  'admin.module_settings.changed': { label: 'Réglages d’un module modifiés', module: 'admin', category: 'activity', severity: 'notice', retention: 'business' },
  'admin.payment_method.changed': { label: 'Moyen de paiement modifié', module: 'admin', category: 'activity', severity: 'notice', retention: 'business' },
  'security.permission.granted': { label: 'Permissions accordées à un rôle', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.permission.revoked': { label: 'Permissions retirées d’un rôle', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.role.created': { label: 'Rôle créé', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.role.updated': { label: 'Rôle modifié', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.membership.created': { label: 'Accès accordé', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.membership.updated': { label: 'Accès modifié', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.membership.deleted': { label: 'Accès supprimé', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.admin.created': { label: 'Administrateur créé', module: 'security', category: 'security', severity: 'notice', retention: 'security' },
  'security.admin.updated': { label: 'Administrateur modifié', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.admin.deactivated': { label: 'Administrateur désactivé', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'security.admin.reactivated': { label: 'Administrateur réactivé', module: 'security', category: 'security', severity: 'warning', retention: 'security' },
  'audit.export.generated': { label: 'Journal exporté', module: 'audit', category: 'security', severity: 'notice', retention: 'security' },
  'audit.journal.cross_tenant_viewed': { label: 'Journal consulté par la plateforme', module: 'audit', category: 'security', severity: 'notice', retention: 'security' },
} as const satisfies Record<string, AuditEventTypeDefinition>;

export type NativeAuditEventType = keyof typeof AUDIT_EVENT_TYPES;

export interface AuditModuleDefinition {
  label: string;
  /** Read permission of the source module (any of). Security events also need audit.security.view. */
  anyOf: string[];
  /** Release flag the module depends on (its events are hidden when the module is off). */
  flag?: 'business_management' | 'whatsapp_business';
  /** Platform-only data (subscriptions, external catalogs). */
  platformOnly?: boolean;
}

/** Modules of the feed, including the adapters of the historical audit tables. */
export const AUDIT_MODULES = {
  orders: { label: 'Commandes', anyOf: ['orders.view'] },
  payments: { label: 'Paiements', anyOf: ['orders.view'] },
  shipping: { label: 'Livraison', anyOf: ['orders.view', 'shipping.view'] },
  catalog: { label: 'Catalogue', anyOf: ['catalog.view'] },
  customers: { label: 'Clients', anyOf: ['customers.view'] },
  admin: { label: 'Paramètres', anyOf: ['tenant_settings.view'] },
  security: { label: 'Accès et rôles', anyOf: ['audit.security.view'] },
  audit: { label: 'Journal', anyOf: ['audit.security.view'] },
  gestion_suppliers: { label: 'Gestion · Fournisseurs', anyOf: ['suppliers.view'], flag: 'business_management' },
  gestion_purchases: { label: 'Gestion · Achats', anyOf: ['purchases.view'], flag: 'business_management' },
  gestion_inventory: { label: 'Gestion · Stocks', anyOf: ['inventory.view'], flag: 'business_management' },
  gestion_treasury: { label: 'Gestion · Trésorerie', anyOf: ['treasury.view'], flag: 'business_management' },
  whatsapp: { label: 'WhatsApp', anyOf: ['whatsapp.view'], flag: 'whatsapp_business' },
  reviews: { label: 'Avis clients', anyOf: ['reviews.view'] },
  events: { label: 'Événementiel', anyOf: ['events.view'] },
  notifications: { label: 'Notifications', anyOf: ['tenant_settings.view'] },
  platform_billing: { label: 'Abonnement (plateforme)', anyOf: [], platformOnly: true },
  external_catalog: { label: 'Import de catalogues', anyOf: [], platformOnly: true },
} as const satisfies Record<string, AuditModuleDefinition>;

export type AuditModule = keyof typeof AUDIT_MODULES;
export const AUDIT_MODULE_KEYS = Object.keys(AUDIT_MODULES) as AuditModule[];

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  activity: 'Activité',
  automation: 'Automatisations',
  security: 'Sécurité',
};

export const AUDIT_ACTOR_LABELS: Record<AuditActorKind, string> = {
  admin: 'Administrateur',
  platform_owner: 'Plateforme Lepefy',
  customer: 'Client',
  system: 'Système',
  provider: 'Prestataire',
  automation: 'Automatisation',
  unknown: 'Auteur non enregistré',
};

// ─── Historical sources (adapters) ─────────────────────────────────────────

const GESTION_LABELS: Record<string, string> = {
  'supplier.created': 'Fournisseur créé', 'supplier.updated': 'Fournisseur modifié',
  'purchase.created': 'Achat créé', 'purchase.updated': 'Achat modifié', 'purchase.status_changed': 'Statut de l’achat modifié',
  'receipt.recorded': 'Réception enregistrée', 'receipt.reversed': 'Réception annulée', 'inventory.adjusted': 'Stock ajusté (Gestion)',
  'payment.recorded': 'Paiement fournisseur enregistré', 'payment.verified': 'Paiement fournisseur vérifié', 'payment.voided': 'Paiement fournisseur annulé',
  'allocation.created': 'Paiement affecté', 'allocation.reversed': 'Affectation retirée',
  'document.uploaded': 'Document ajouté', 'document.deleted': 'Document supprimé',
};

const PREORDER_LABELS: Record<string, string> = {
  created: 'Précommande créée', updated: 'Précommande modifiée', link_issued: 'Lien de paiement envoyé', link_revoked: 'Lien de paiement révoqué',
  link_opened: 'Lien de paiement ouvert', payment_declared: 'Paiement déclaré par le client', payment_confirmed: 'Paiement de la précommande confirmé',
  order_created: 'Commande créée depuis la précommande', reopened: 'Précommande rouverte', cancelled: 'Précommande annulée', expired: 'Précommande expirée',
  stock_conflict: 'Conflit de stock', duplicate_payment: 'Paiement en double', amount_mismatch: 'Montant différent',
  notification_sent: 'Notification envoyée', notification_skipped: 'Notification non envoyée',
};

const WHATSAPP_LABELS: Record<string, string> = {
  agent_takeover: 'Conversation reprise par l’équipe', automation_resumed: 'Automatisation relancée par l’équipe',
  automation_auto_resumed: 'Automatisation relancée automatiquement', business_app_reply: 'Réponse depuis l’application WhatsApp Business',
  channel_created: 'Canal WhatsApp connecté', channel_updated: 'Canal WhatsApp modifié', channel_settings_updated: 'Réglages WhatsApp modifiés',
  channel_test_sent: 'Message de test envoyé', conversation_closed: 'Conversation clôturée', conversation_reopened: 'Conversation rouverte',
  conversation_erased: 'Conversation effacée', handoff_requested: 'Passage à un opérateur demandé', rules_updated: 'Réponses automatiques modifiées',
};

const REVIEW_LABELS: Record<string, string> = {
  submitted: 'Avis reçu', publish: 'Avis publié', published: 'Avis publié', reject: 'Avis refusé', rejected: 'Avis refusé',
  hide: 'Avis masqué', hidden: 'Avis masqué', restore: 'Avis rétabli', restored: 'Avis rétabli',
};

const SUBSCRIPTION_LABELS: Record<string, string> = {
  payment_recorded: 'Paiement d’abonnement enregistré', suspend: 'Boutique suspendue', reactivate: 'Boutique réactivée',
  set_paid_until: 'Échéance d’abonnement modifiée', set_payment_link: 'Lien de paiement d’abonnement modifié',
  set_suspension_policy: 'Politique de suspension modifiée', suspend_module: 'Module suspendu', reactivate_module: 'Module réactivé',
};

const EXTERNAL_CATALOG_LABELS: Record<string, string> = {
  fetched: 'Catalogue externe actualisé', created: 'Produit créé depuis un catalogue externe', updated: 'Produit mis à jour depuis un catalogue externe',
  linked: 'Produit associé à un catalogue externe', images_applied: 'Photos importées', dismissed: 'Article ignoré', restored: 'Article rétabli',
};

const LEGACY_ACCESS_LABELS: Record<string, string> = {
  membership_created: 'Accès accordé (historique)', membership_role_changed: 'Rôle modifié (historique)',
  membership_enabled: 'Administrateur réactivé (historique)', membership_disabled: 'Administrateur désactivé (historique)',
  role_created: 'Rôle créé (historique)', role_updated: 'Rôle modifié (historique)', profile_updated: 'Profil modifié (historique)',
};

const OTHER_LABELS: Record<string, string> = {
  'events.event.capacity_adjusted': 'Capacité de l’événement modifiée',
  'notifications.delivery.failed': 'Notification non délivrée',
  'notifications.delivery.abandoned': 'Notification abandonnée',
};

function humanize(value: string): string {
  const text = value.replace(/[_.]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Événement';
}

/** French label of any feed event type (native or historical). */
export function auditEventLabel(eventType: string): string {
  const native = (AUDIT_EVENT_TYPES as Record<string, AuditEventTypeDefinition>)[eventType];
  if (native) return native.label;
  if (OTHER_LABELS[eventType]) return OTHER_LABELS[eventType]!;
  const prefixed: [string, Record<string, string>][] = [
    ['gestion.', GESTION_LABELS], ['orders.preorder.', PREORDER_LABELS], ['whatsapp.conversation.', WHATSAPP_LABELS],
    ['reviews.review.', REVIEW_LABELS], ['billing.subscription.', SUBSCRIPTION_LABELS],
    ['catalog.external_import.', EXTERNAL_CATALOG_LABELS], ['security.legacy.', LEGACY_ACCESS_LABELS],
  ];
  for (const [prefix, labels] of prefixed) {
    if (eventType.startsWith(prefix)) {
      const rest = eventType.slice(prefix.length);
      return labels[rest] ?? humanize(rest);
    }
  }
  return humanize(eventType);
}

/** Event types offered in the « Événement » filter for a set of modules. */
export function auditEventOptions(modules: readonly string[]): { value: string; label: string }[] {
  return Object.entries(AUDIT_EVENT_TYPES)
    .filter(([, definition]) => modules.includes(definition.module))
    .map(([value, definition]) => ({ value, label: definition.label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

// ─── Fields and values shown in « Avant / Après » ──────────────────────────

const FIELD_LABELS: Record<string, string> = {
  status: 'Statut', payment_status: 'Statut du paiement', tracking_code: 'Numéro de suivi', tracking_carrier: 'Transporteur',
  shipping_tracking_mode: 'Mode de suivi', fulfillment_type: 'Mode de remise', subtotal: 'Sous-total', shipping_cost: 'Livraison', total: 'Total',
  full_name: 'Nom', email: 'E-mail', phone: 'Téléphone', shipping_address: 'Adresse de livraison', notes: 'Notes',
  shipping_creation_status: 'Brouillon d’expédition', shipping_normalized_status: 'Statut transporteur',
  price: 'Prix', compare_at_price: 'Prix barré', active: 'Actif', min_order_quantity: 'Quantité minimum', order_quantity_step: 'Incrément',
  stock: 'Stock', name: 'Nom', name_alt: 'Nom secondaire', slug: 'Adresse web', category_id: 'Catégorie', featured: 'Mis en avant',
  weight_grams: 'Poids (g)', storage_type: 'Conservation', description: 'Description', image_url: 'Image', images: 'Photos',
  enabled: 'Activé', role: 'Rôle', capacity_total: 'Capacité', method: 'Moyen', label: 'Libellé', value: 'Coordonnées', extra: 'Détails',
  sort_order: 'Ordre', shipping_provider: 'Transporteur de la boutique', packlink_api_key: 'Clé Packlink', stripe_account_id: 'Compte Stripe',
  storefront_url: 'Adresse de la boutique', click_collect_enabled: 'Retrait en magasin', shipping_pricing_mode: 'Tarification de la livraison',
  source: 'Source', is_ambassador: 'Ambassadeur', tenant_id: 'Boutique', code: 'Code', scope: 'Portée',
};

export function auditFieldLabel(field: string): string {
  if (field.startsWith('config.')) return `Réglage « ${field.slice(7)} »`;
  return FIELD_LABELS[field] ?? humanize(field);
}

// ─── « Détails » (metadata) of an event ────────────────────────────────────

const DETAIL_LABELS: Record<string, string> = {
  fulfillment_type: 'Mode de remise', origin: 'Origine', sales_channel: 'Canal de vente', payment_method: 'Moyen de paiement',
  payment_status: 'Statut du paiement', total: 'Total', is_test: 'Commande de test', confirmation_source: 'Confirmation',
  external_payment_type: 'Type de paiement externe', received_at: 'Encaissé le', reference: 'Référence', has_note: 'Note jointe',
  attempts: 'Tentatives', max_attempts: 'Tentatives maximum', error: 'Erreur', provider: 'Prestataire', provider_reference: 'Référence prestataire',
  provider_status: 'Statut prestataire', operation: 'Opération', role_code: 'Rôle', permissions: 'Permissions', count: 'Nombre',
  membership_id: 'Accès', rows: 'Lignes', truncated: 'Tronqué', tab: 'Onglet', period: 'Période', module: 'Module', outcome: 'Résultat',
  perimeter: 'Périmètre', notification_type: 'Notification', module_key: 'Module', reason: 'Motif', reason_code: 'Code motif',
  delta: 'Écart', fields: 'Champs', source_id: 'Source', checkout_session_id: 'Précommande', price: 'Prix', active: 'Actif', stock: 'Stock',
  auto_resume_minutes: 'Reprise automatique (min)', template: 'Modèle', units: 'Unités', amount: 'Montant', purchase: 'Achat', payment: 'Paiement',
  from: 'De', to: 'Vers', before: 'Avant', after: 'Après', changes_truncated: 'Modifications abrégées', metadata_truncated: 'Détails abrégés',
};

const DETAIL_VALUE_LABELS: Record<string, Record<string, string>> = {
  fulfillment_type: { delivery: 'Livraison', pickup: 'Retrait' },
  origin: { storefront: 'Boutique en ligne', assisted: 'Commande assistée' },
  operation: { insert: 'Ajout', update: 'Modification', delete: 'Suppression' },
  perimeter: { tenant: 'Une boutique', all_tenants: 'Toutes les boutiques' },
  confirmation_source: { stripe_webhook: 'Stripe', admin_verified: 'Vérifié par l’équipe', admin_recorded: 'Encaissement enregistré' },
  payment_method: { stripe: 'Carte bancaire', external_link: 'Lien de paiement', in_store: 'En magasin', cash: 'Espèces', manual: 'Manuel', satispay: 'Satispay' },
  tab: { activity: 'Activité', automation: 'Automatisations', security: 'Sécurité' },
};

export function auditDetailLabel(key: string): string {
  return DETAIL_LABELS[key] ?? humanize(key);
}

/** French label of a known value (« delivery » → « Livraison »), else the value itself. */
export function auditDetailValue(key: string, value: string): string {
  return DETAIL_VALUE_LABELS[key]?.[value] ?? value;
}

// ─── Links to the original resource ────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admin page of a resource, or null when it has no page (or the id is not safe). */
export function auditResourceHref(resourceType: string | null, resourceId: string | null): string | null {
  if (!resourceType) return null;
  const id = resourceId && UUID.test(resourceId) ? resourceId : null;
  switch (resourceType) {
    case 'order': return id && `/admin/orders/${id}`;
    case 'preorder': return id && `/admin/orders/precommandes/${id}`;
    case 'product': return id && `/admin/catalogue/${id}`;
    case 'customer': return id && `/admin/clients/${id}`;
    case 'supplier': return id && `/admin/gestion/fournisseurs/${id}`;
    case 'purchase': return id && `/admin/gestion/achats/${id}`;
    case 'payment': return id && `/admin/gestion/tresorerie/${id}`;
    case 'inventory': return '/admin/gestion/stocks';
    case 'event': return id && `/admin/evenementiel/evenements/${id}`;
    case 'review': return '/admin/avis';
    case 'whatsapp_conversation': return id && `/admin/canaux/whatsapp/conversations?c=${id}`;
    case 'tenant': case 'module_settings': return '/admin/parametres';
    case 'feature_flag': return '/admin/parametres/fonctionnalites';
    case 'payment_method': return '/admin/parametres/paiements';
    case 'admin_role': return '/admin/platform/access';
    default: return null;
  }
}

export const AUDIT_RESOURCE_LABELS: Record<string, string> = {
  order: 'Commande', preorder: 'Précommande', product: 'Produit', customer: 'Client', supplier: 'Fournisseur', purchase: 'Achat',
  receipt: 'Réception', payment: 'Paiement fournisseur', allocation: 'Affectation', document: 'Document', inventory: 'Stock',
  event: 'Événement', review: 'Avis', whatsapp_conversation: 'Conversation WhatsApp', tenant: 'Boutique', module_settings: 'Module',
  feature_flag: 'Fonctionnalité', payment_method: 'Moyen de paiement', admin_role: 'Rôle', admin_user: 'Administrateur',
  notification: 'Notification', tenant_subscription: 'Abonnement', external_catalog_item: 'Article de catalogue externe', audit_export: 'Export',
};
