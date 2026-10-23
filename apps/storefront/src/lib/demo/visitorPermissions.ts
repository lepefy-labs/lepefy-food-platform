/**
 * Capabilities du rôle demo_visitor (migration 167) : lecture seule.
 * Miroir exact de la liste SQL (test de parité tests/unit/demoExperience.spec.ts).
 * Jamais une capability d'action (*.manage, *.confirm, *.refund…), jamais platform.*,
 * jamais audit.* ni tenant_settings.* ni billing.*.
 */
export const DEMO_VISITOR_ROLE = 'demo_visitor';

export const DEMO_VISITOR_PERMISSIONS = [
  'orders.view', 'catalog.view', 'customers.view', 'campaigns.view', 'reviews.view', 'shipping.view',
  'events.view', 'event_reservations.view', 'event_payments.view',
  'suppliers.view', 'purchases.view', 'inventory.view', 'treasury.view', 'ai_usage.view',
] as const;

/** Message renvoyé par les API admin quand un visiteur tente une action. */
export const DEMO_VISITOR_DENIED_MESSAGE = 'Mode visite de la démo : cette action est désactivée. Demandez une démonstration guidée pour l’essayer.';
