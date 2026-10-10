import type { AdminWorkspace } from '@/lib/admin/workspace';

interface RoutePermissionRule {
  prefix: string;
  permission: string;
  exact?: boolean;
  /** Alternative equivalenti a `permission`: basta averne una. */
  anyOf?: string[];
}

const RULES: RoutePermissionRule[] = [
  { prefix: '/admin/platform', permission: 'platform.access' },
  // Gestion du commerce (visibile solo con il flag business_management, controllato dalle pagine).
  { prefix: '/admin/gestion/fournisseurs/nouveau', permission: 'suppliers.manage' },
  { prefix: '/admin/gestion/fournisseurs', permission: 'suppliers.view' },
  { prefix: '/admin/gestion/achats/nouveau', permission: 'purchases.manage' },
  { prefix: '/admin/gestion/achats', permission: 'purchases.view' },
  { prefix: '/admin/gestion/tresorerie/nouveau', permission: 'treasury.manage' },
  { prefix: '/admin/gestion/tresorerie', permission: 'treasury.view' },
  { prefix: '/admin/gestion/stocks', permission: 'inventory.view' },
  { prefix: '/admin/gestion', permission: 'suppliers.view', anyOf: ['purchases.view', 'treasury.view', 'inventory.view'] },
  { prefix: '/admin/team', permission: 'platform.users.manage' },
  { prefix: '/admin/evenementiel/paiements-en-attente', permission: 'event_payments.view' },
  { prefix: '/admin/evenementiel/reservations', permission: 'event_reservations.view' },
  // Locations: rental reservations and requests (customer data), same capability as the
  // rental-reservations APIs it calls.
  { prefix: '/admin/evenementiel/reservations-materiel', permission: 'event_reservations.view' },
  { prefix: '/admin/evenementiel/evenements', permission: 'events.view' },
  // Demandes traiteur (service_inquiries: customer data), same capability as /api/admin/evenementiel/inquiries.
  { prefix: '/admin/evenementiel/devis', permission: 'event_reservations.view' },
  { prefix: '/admin/evenementiel/livraison-materiel', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel/contenu', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel/services', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel/galerie', permission: 'event_content.manage' },
  { prefix: '/admin/evenementiel', permission: 'events.view' },
  { prefix: '/admin/orders', permission: 'orders.view' },
  { prefix: '/admin/clients/campagnes', permission: 'campaigns.view' },
  { prefix: '/admin/clients/segments', permission: 'customers.view' },
  { prefix: '/admin/clients', permission: 'customers.view' },
  { prefix: '/admin/avis', permission: 'reviews.view' },
  { prefix: '/admin/checkout-funnel', permission: 'orders.view' },
  { prefix: '/admin/paiements-en-attente', permission: 'orders.view' },
  { prefix: '/admin/paiements-carte', permission: 'orders.view' },
  { prefix: '/admin/catalogue', permission: 'catalog.view' },
  { prefix: '/admin/accueil-slides', permission: 'catalog.manage' },
  { prefix: '/admin/loyalty/scan', permission: 'loyalty.scan' },
  { prefix: '/admin/livraison', permission: 'shipping.view' },
  { prefix: '/admin/loyalty', permission: 'loyalty.manage' },
  { prefix: '/admin/ambassadeurs', permission: 'growth.manage' },
  { prefix: '/admin/nala-analytics', permission: 'ai_usage.view' },
  // Canal WhatsApp (visibile solo con il flag whatsapp_business, controllato dalle pagine).
  { prefix: '/admin/canaux/whatsapp', permission: 'whatsapp.view' },
  { prefix: '/admin/ai-lab', permission: 'ai_knowledge.manage' },
  { prefix: '/admin/parametres', permission: 'tenant_settings.view' },
  // Moved out of Paramètres with the same access (story, QR/poster: tenant_settings.*).
  { prefix: '/admin/contenu', permission: 'tenant_settings.view' },
  { prefix: '/admin/outils', permission: 'tenant_settings.view' },
  { prefix: '/admin/billing', permission: 'billing.view' },
  { prefix: '/admin/ai-usage', permission: 'ai_usage.view' },
];

export function isPersonalAdminPath(pathname: string): boolean {
  return pathname.startsWith('/admin/securite');
}

// A prefix matches whole path segments only: `/admin/evenementiel/reservations`
// must not capture `/admin/evenementiel/reservations-materiel`.
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function ruleForAdminPath(pathname: string): RoutePermissionRule | undefined {
  return RULES.find((candidate) => candidate.exact ? pathname === candidate.prefix : matchesPrefix(pathname, candidate.prefix));
}

export function permissionForAdminPath(pathname: string, workspace: AdminWorkspace): string | null {
  if (pathname === '/admin' || pathname === '/admin/') return workspace === 'events' ? 'events.view' : 'orders.view';
  return ruleForAdminPath(pathname)?.permission ?? null;
}

/** Tutte le capability che aprono la pagina (basta averne una); null = pagina non mappata. */
export function permissionsForAdminPath(pathname: string, workspace: AdminWorkspace): string[] | null {
  if (pathname === '/admin' || pathname === '/admin/') return [permissionForAdminPath(pathname, workspace)!];
  const rule = ruleForAdminPath(pathname);
  return rule ? [rule.permission, ...(rule.anyOf ?? [])] : null;
}

// Landing pages in order of preference. A candidate is used only when the
// permissions really open it (same rules as the layout guard), so the layout
// redirect can never point to a page that redirects again.
const LANDING_PAGES: Record<AdminWorkspace, string[]> = {
  events: ['/admin', '/admin/evenementiel/reservations', '/admin/evenementiel/contenu'],
  shop: ['/admin', '/admin/catalogue', '/admin/clients', '/admin/avis', '/admin/loyalty/scan', '/admin/livraison', '/admin/billing', '/admin/ai-usage'],
};

export function defaultAdminDestination(permissions: string[], workspace: AdminWorkspace): string | null {
  const has = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  const opens = (path: string, pathWorkspace: AdminWorkspace) => (permissionsForAdminPath(path, pathWorkspace) ?? []).some(has);
  const page = LANDING_PAGES[workspace].find((path) => opens(path, workspace));
  if (page) return page;
  if (workspace === 'events' && has('scan.access')) return '/scan';
  if (opens('/admin/platform', workspace)) return '/admin/platform';
  if (has('scan.access')) return '/scan';
  return null;
}
