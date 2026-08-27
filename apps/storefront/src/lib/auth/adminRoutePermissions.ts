import type { AdminWorkspace } from '@/lib/admin/workspace';

interface RoutePermissionRule {
  prefix: string;
  permission: string;
  exact?: boolean;
}

const RULES: RoutePermissionRule[] = [
  { prefix: '/admin/platform', permission: 'platform.access' },
  { prefix: '/admin/team', permission: 'platform.users.manage' },
  { prefix: '/admin/evenementiel/paiements-en-attente', permission: 'event_payments.view' },
  { prefix: '/admin/evenementiel/reservations', permission: 'event_reservations.view' },
  { prefix: '/admin/evenementiel/evenements', permission: 'events.view' },
  { prefix: '/admin/evenementiel/devis', permission: 'events.view' },
  { prefix: '/admin/evenementiel/reservations-materiel', permission: 'events.view' },
  { prefix: '/admin/evenementiel/contenu', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel/services', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel/galerie', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel', permission: 'events.view' },
  { prefix: '/admin/orders', permission: 'orders.view' },
  { prefix: '/admin/checkout-funnel', permission: 'orders.view' },
  { prefix: '/admin/paiements-en-attente', permission: 'orders.view' },
  { prefix: '/admin/catalogue', permission: 'catalog.view' },
  { prefix: '/admin/accueil-slides', permission: 'catalog.manage' },
  { prefix: '/admin/loyalty/scan', permission: 'loyalty.scan' },
  { prefix: '/admin/livraison', permission: 'shipping.view' },
  { prefix: '/admin/loyalty', permission: 'loyalty.manage' },
  { prefix: '/admin/ambassadeurs', permission: 'growth.manage' },
  { prefix: '/admin/ai-lab', permission: 'ai_knowledge.manage' },
  { prefix: '/admin/parametres', permission: 'tenant_settings.view' },
  { prefix: '/admin/billing', permission: 'billing.view' },
  { prefix: '/admin/ai-usage', permission: 'ai_usage.view' },
];

export function isPersonalAdminPath(pathname: string): boolean {
  return pathname.startsWith('/admin/securite');
}

export function permissionForAdminPath(pathname: string, workspace: AdminWorkspace): string | null {
  if (pathname === '/admin' || pathname === '/admin/') {
    return workspace === 'events' ? 'events.view' : 'orders.view';
  }
  const rule = RULES.find((candidate) => candidate.exact ? pathname === candidate.prefix : pathname.startsWith(candidate.prefix));
  return rule?.permission ?? null;
}

export function defaultAdminDestination(permissions: string[], workspace: AdminWorkspace): string | null {
  const has = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  if (workspace === 'events') {
    if (has('events.view')) return '/admin';
    if (has('event_reservations.view')) return '/admin/evenementiel/reservations';
    if (has('event_payments.view')) return '/admin/evenementiel/reservations';
    if (has('event_content.manage')) return '/admin/evenementiel/contenu';
    if (has('scan.access')) return '/scan';
  } else {
    if (has('orders.view')) return '/admin';
    if (has('catalog.view')) return '/admin/catalogue';
    if (has('loyalty.scan')) return '/admin/loyalty/scan';
    if (has('shipping.view')) return '/admin/livraison';
    if (has('billing.view')) return '/admin/billing';
    if (has('ai_usage.view')) return '/admin/ai-usage';
  }
  if (has('platform.access')) return '/admin/platform';
  if (has('scan.access')) return '/scan';
  return null;
}
