import {
  IconBrandWhatsapp, IconBriefcase, IconClipboardList, IconHome, IconBuildingWarehouse, IconCalendarEvent, IconCash, IconChartBar, IconCreditCard,
  IconFileInvoice, IconFileText, IconGift, IconHistory, IconLayoutDashboard, IconMessageCircle, IconPackage, IconPackages, IconPhoto,
  IconPlus, IconQrcode, IconScan, IconSettings, IconShoppingBag, IconSparkles, IconStar, IconToolsKitchen2, IconTruck,
  IconTruckDelivery, IconTruckLoading, IconUserPlus, IconUsers, type Icon,
} from '@tabler/icons-react';
import type { AdminWorkspace } from './workspace';
import type { AdminTone } from './tokens';

/**
 * Admin navigation registry — the single list behind the sidebar, the mobile
 * drawer, the mobile bottom bar and the command palette. Adding a module =
 * one entry here. Visibility is resolved on the server (resolveAdminNavigation)
 * from the same permissions the protected layout checks; it is UX only and
 * never replaces requirePermission / the layout route check.
 *
 * tests/unit/adminNavigation.spec.ts keeps every entry consistent with
 * lib/auth/adminRoutePermissions.ts.
 */

export type AdminNavGroup =
  | 'Essentiel' | 'Ventes' | 'Croissance' | 'Canaux' | 'Gestion' | 'Contenu & outils' | 'Administration'
  | 'Événementiel' | 'Service sur place';
export type AdminNavFlag = 'gestion' | 'whatsapp' | 'activity';
export type AdminNavBadgeKey = 'pendingPayments' | 'pendingEventRequests' | 'newInquiries' | 'pendingRentalRequests' | 'preordersToVerify';

export interface AdminNavItem {
  id: string;
  label: string;
  href: string;
  icon: Icon;
  group: AdminNavGroup;
  workspace: AdminWorkspace | 'all';
  /** Visible when the admin has at least one of these capabilities. */
  anyOf: string[];
  flag?: AdminNavFlag;
  /** 'prefix' (default) also marks sub-pages active. */
  match?: 'exact' | 'prefix';
  /** Extra paths that mark this entry active. */
  alsoActive?: { href: string; match?: 'exact' | 'prefix' }[];
  badge?: { key: AdminNavBadgeKey; tone: AdminTone; label: string };
  /** Position in the mobile bottom bar (lower first); absent = drawer only. */
  mobile?: number;
  /** Extra words for the command palette. */
  keywords?: string[];
  /**
   * Sub-pages of the module: listed under the entry while it is active (sidebar),
   * as a tab strip on small screens and in the command palette.
   */
  children?: AdminNavChild[];
}

export interface AdminNavChild {
  label: string;
  href: string;
  /** Narrower than the entry's (e.g. a sub-page with its own capability); default: the entry's anyOf. */
  anyOf?: string[];
  badge?: { key: AdminNavBadgeKey; tone: AdminTone; label: string };
  keywords?: string[];
}

export interface AdminQuickAction {
  id: string;
  label: string;
  href: string;
  icon: Icon;
  workspace: AdminWorkspace | 'all';
  anyOf: string[];
  keywords?: string[];
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  'Essentiel', 'Événementiel', 'Service sur place', 'Ventes', 'Croissance', 'Canaux', 'Gestion', 'Contenu & outils', 'Administration',
];

/**
 * Daily work: always open, the shop's « Essentiel » without a heading. The
 * other groups fold (open on their active entry) so the rail stays short
 * without hiding any module.
 */
export const ADMIN_NAV_PRIMARY_GROUPS: readonly AdminNavGroup[] = ['Essentiel', 'Événementiel', 'Service sur place'];

export function isPrimaryNavGroup(group: AdminNavGroup): boolean {
  return ADMIN_NAV_PRIMARY_GROUPS.includes(group);
}

export const ADMIN_NAV: AdminNavItem[] = [
  // Essentiel — the shop's daily work (Aujourd'hui, Commandes, Produits, Livraisons, Clients)
  { id: 'today', label: 'Aujourd’hui', href: '/admin', icon: IconHome, group: 'Essentiel', workspace: 'shop', anyOf: ['orders.view'], match: 'exact', mobile: 1, keywords: ['accueil', 'tableau de bord', 'priorités', 'dashboard'] },
  { id: 'orders', label: 'Commandes', href: '/admin/orders', icon: IconShoppingBag, group: 'Essentiel', workspace: 'shop', anyOf: ['orders.view'], alsoActive: [{ href: '/admin/paiements-en-attente' }], badge: { key: 'pendingPayments', tone: 'warning', label: 'paiements à vérifier' }, mobile: 2, keywords: ['ordres', 'préparation', 'expédition', 'précommandes', 'session de préparation'],
    children: [
      { label: 'Toutes les commandes', href: '/admin/orders' },
      { label: 'Session de préparation', href: '/admin/orders/preparation', keywords: ['liste groupée', 'imprimer'] },
      { label: 'Précommandes', href: '/admin/orders/precommandes', badge: { key: 'preordersToVerify', tone: 'warning', label: 'précommandes à vérifier' }, keywords: ['whatsapp', 'téléphone', 'assistée'] },
    ] },
  { id: 'catalogue', label: 'Produits', href: '/admin/catalogue', icon: IconPackage, group: 'Essentiel', workspace: 'shop', anyOf: ['catalog.view'], alsoActive: [{ href: '/admin/products' }], mobile: 3, keywords: ['catalogue', 'stock', 'prix', 'catégories'],
    children: [
      { label: 'Tous les produits', href: '/admin/catalogue' },
      { label: 'Promotions & Nouveautés', href: '/admin/catalogue/campagnes', keywords: ['campagne', 'promo'] },
      { label: 'Catégories', href: '/admin/catalogue/categories' },
      { label: 'Règles de quantité', href: '/admin/catalogue/quantity-groups', keywords: ['minimum', 'groupe'] },
    ] },
  { id: 'shipping', label: 'Livraisons', href: '/admin/livraison', icon: IconTruck, group: 'Essentiel', workspace: 'shop', anyOf: ['shipping.view'], keywords: ['packlink', 'zones', 'tarifs', 'expéditions', 'emballages', 'forfait'],
    children: [
      { label: 'Tarification', href: '/admin/livraison', keywords: ['zones', 'tarifs'] },
      { label: 'Emballages', href: '/admin/livraison/emballages', keywords: ['cartons'] },
      { label: 'Expéditions', href: '/admin/livraison/expeditions', keywords: ['packlink', 'brouillons'] },
      { label: 'Assistant expédition', href: '/admin/livraison/assistant' },
      { label: 'Historique des coûts', href: '/admin/livraison/historique' },
      { label: 'Forfait', href: '/admin/livraison/forfait', keywords: ['grille', 'prix'] },
    ] },
  { id: 'customers', label: 'Clients', href: '/admin/clients', icon: IconUsers, group: 'Essentiel', workspace: 'shop', anyOf: ['customers.view'], keywords: ['crm', 'segments', 'campagnes'],
    children: [
      { label: 'Liste des clients', href: '/admin/clients' },
      { label: 'Segments', href: '/admin/clients/segments' },
      { label: 'Campagnes', href: '/admin/clients/campagnes', anyOf: ['campaigns.view'], keywords: ['e-mail', 'marketing'] },
    ] },
  // Ventes
  { id: 'card-payments', label: 'Paiements carte', href: '/admin/paiements-carte', icon: IconCreditCard, group: 'Ventes', workspace: 'shop', anyOf: ['orders.view'], keywords: ['stripe', 'cp-'] },
  { id: 'checkout-funnel', label: 'Funnel checkout', href: '/admin/checkout-funnel', icon: IconChartBar, group: 'Ventes', workspace: 'shop', anyOf: ['orders.view'], match: 'exact', keywords: ['conversion', 'abandon', 'paniers à relancer'] },
  { id: 'loyalty-scan', label: 'Scan fidélité', href: '/admin/loyalty/scan', icon: IconScan, group: 'Ventes', workspace: 'shop', anyOf: ['loyalty.scan'], match: 'exact', mobile: 4, keywords: ['carte', 'caisse', 'points'] },
  // Croissance
  { id: 'loyalty', label: 'Fidélité & parrainage', href: '/admin/loyalty', icon: IconGift, group: 'Croissance', workspace: 'shop', anyOf: ['loyalty.manage'], match: 'exact' },
  { id: 'ambassadors', label: 'Ambassadeurs', href: '/admin/ambassadeurs', icon: IconStar, group: 'Croissance', workspace: 'shop', anyOf: ['growth.manage'], match: 'exact', keywords: ['commissions'] },
  { id: 'reviews', label: 'Avis clients', href: '/admin/avis', icon: IconMessageCircle, group: 'Croissance', workspace: 'shop', anyOf: ['reviews.view'], keywords: ['modération', 'notes'] },
  { id: 'nala-analytics', label: 'Nala Analytics', href: '/admin/nala-analytics', icon: IconSparkles, group: 'Croissance', workspace: 'shop', anyOf: ['ai_usage.view'], keywords: ['assistant', 'ia'] },
  { id: 'ai-lab', label: 'IA — Base de connaissance', href: '/admin/ai-lab', icon: IconSparkles, group: 'Croissance', workspace: 'shop', anyOf: ['ai_knowledge.manage'], match: 'exact', keywords: ['nala', 'faq'] },
  // Canaux
  { id: 'whatsapp', label: 'WhatsApp', href: '/admin/canaux/whatsapp', icon: IconBrandWhatsapp, group: 'Canaux', workspace: 'shop', anyOf: ['whatsapp.view'], flag: 'whatsapp', keywords: ['conversations', 'messages'] },
  // Gestion
  { id: 'gestion', label: 'Vue d’ensemble', href: '/admin/gestion', icon: IconLayoutDashboard, group: 'Gestion', workspace: 'shop', anyOf: ['suppliers.view', 'purchases.view', 'treasury.view', 'inventory.view'], flag: 'gestion', match: 'exact', keywords: ['gestion', 'commerce'] },
  { id: 'suppliers', label: 'Fournisseurs', href: '/admin/gestion/fournisseurs', icon: IconBuildingWarehouse, group: 'Gestion', workspace: 'shop', anyOf: ['suppliers.view'], flag: 'gestion' },
  { id: 'purchases', label: 'Achats & réceptions', href: '/admin/gestion/achats', icon: IconTruckLoading, group: 'Gestion', workspace: 'shop', anyOf: ['purchases.view'], flag: 'gestion', keywords: ['bons de commande'] },
  { id: 'inventory', label: 'Stocks', href: '/admin/gestion/stocks', icon: IconPackages, group: 'Gestion', workspace: 'shop', anyOf: ['inventory.view'], flag: 'gestion', keywords: ['inventaire', 'mouvements'] },
  { id: 'treasury', label: 'Trésorerie', href: '/admin/gestion/tresorerie', icon: IconCash, group: 'Gestion', workspace: 'shop', anyOf: ['treasury.view'], flag: 'gestion', keywords: ['paiements fournisseurs', 'échéances'] },
  // Événementiel
  { id: 'events-overview', label: 'Vue d’ensemble', href: '/admin', icon: IconCalendarEvent, group: 'Événementiel', workspace: 'events', anyOf: ['events.view'], match: 'exact', alsoActive: [{ href: '/admin/evenementiel', match: 'exact' }], mobile: 1 },
  { id: 'events', label: 'Événements', href: '/admin/evenementiel/evenements', icon: IconCalendarEvent, group: 'Événementiel', workspace: 'events', anyOf: ['events.view'] },
  // The list route accepts event_reservations.view only (adminRoutePermissions).
  { id: 'event-reservations', label: 'Réservations / Paiements', href: '/admin/evenementiel/reservations', icon: IconFileInvoice, group: 'Événementiel', workspace: 'events', anyOf: ['event_reservations.view'], alsoActive: [{ href: '/admin/evenementiel/paiements-en-attente' }], badge: { key: 'pendingEventRequests', tone: 'warning', label: 'demandes en attente' }, mobile: 2 },
  { id: 'catering-requests', label: 'Demandes traiteur', href: '/admin/evenementiel/devis', icon: IconBriefcase, group: 'Événementiel', workspace: 'events', anyOf: ['event_reservations.view'], badge: { key: 'newInquiries', tone: 'info', label: 'nouvelles demandes' }, keywords: ['devis'] },
  { id: 'rentals', label: 'Locations', href: '/admin/evenementiel/reservations-materiel', icon: IconToolsKitchen2, group: 'Événementiel', workspace: 'events', anyOf: ['event_reservations.view'], badge: { key: 'pendingRentalRequests', tone: 'warning', label: 'demandes en attente' }, keywords: ['matériel'] },
  { id: 'event-content', label: 'Galerie / Contenu', href: '/admin/evenementiel/contenu', icon: IconPhoto, group: 'Événementiel', workspace: 'events', anyOf: ['event_content.manage'], alsoActive: [{ href: '/admin/evenementiel/services' }, { href: '/admin/evenementiel/galerie' }] },
  { id: 'rental-delivery', label: 'Livraison matériel', href: '/admin/evenementiel/livraison-materiel', icon: IconTruckDelivery, group: 'Événementiel', workspace: 'events', anyOf: ['event_content.manage'] },
  { id: 'event-scan', label: 'Service repas / Scan', href: '/scan', icon: IconScan, group: 'Service sur place', workspace: 'events', anyOf: ['scan.access'], match: 'exact', mobile: 3, keywords: ['billets', 'repas'] },
  // Contenu & outils
  { id: 'home-slides', label: 'Slides d’accueil', href: '/admin/accueil-slides', icon: IconPhoto, group: 'Contenu & outils', workspace: 'shop', anyOf: ['catalog.manage'], match: 'exact', keywords: ['bannière', 'hero'] },
  { id: 'public-content', label: 'Contenu public', href: '/admin/contenu', icon: IconFileText, group: 'Contenu & outils', workspace: 'all', anyOf: ['tenant_settings.view'], keywords: ['notre origine', 'histoire'] },
  { id: 'tools', label: 'Outils & QR', href: '/admin/outils', icon: IconQrcode, group: 'Contenu & outils', workspace: 'all', anyOf: ['tenant_settings.view'], keywords: ['affiche', 'qr code'] },
  // Administration
  { id: 'settings', label: 'Paramètres', href: '/admin/parametres', icon: IconSettings, group: 'Administration', workspace: 'all', anyOf: ['tenant_settings.view'], keywords: ['réglages', 'configuration', 'notifications', 'préparation papier'] },
  { id: 'activity', label: 'Journal d’activité', href: '/admin/activite', icon: IconHistory, group: 'Administration', workspace: 'all', anyOf: ['audit.view'], flag: 'activity', keywords: ['audit', 'historique', 'traçabilité', 'qui a modifié'] },
  { id: 'billing', label: 'Abonnement', href: '/admin/billing', icon: IconCreditCard, group: 'Administration', workspace: 'all', anyOf: ['billing.view'], match: 'exact', keywords: ['facture'] },
  { id: 'ai-usage', label: 'Utilisation IA', href: '/admin/ai-usage', icon: IconChartBar, group: 'Administration', workspace: 'all', anyOf: ['ai_usage.view'], match: 'exact' },
];

export const ADMIN_QUICK_ACTIONS: AdminQuickAction[] = [
  { id: 'new-order', label: 'Nouvelle commande', href: '/admin/orders/new', icon: IconPlus, workspace: 'shop', anyOf: ['orders.manage'], keywords: ['précommande', 'whatsapp', 'téléphone'] },
  { id: 'prepare-orders', label: 'Préparer les commandes', href: '/admin/orders/preparation', icon: IconClipboardList, workspace: 'shop', anyOf: ['orders.view'], keywords: ['session de préparation', 'liste groupée', 'imprimer', 'picking'] },
  { id: 'new-product', label: 'Nouveau produit', href: '/admin/catalogue/nouveau', icon: IconPlus, workspace: 'shop', anyOf: ['catalog.manage'] },
  { id: 'new-catalog-campaign', label: 'Nouvelle campagne catalogue', href: '/admin/catalogue/campagnes/nouvelle', icon: IconPlus, workspace: 'shop', anyOf: ['catalog.manage'], keywords: ['promotion', 'nouveauté'] },
  { id: 'new-customer', label: 'Ajouter un client', href: '/admin/clients?new=1', icon: IconUserPlus, workspace: 'shop', anyOf: ['customers.manage'] },
];

export interface AdminNavContext {
  workspace: AdminWorkspace;
  permissions: string[];
  isPlatformOwner: boolean;
  flags: Record<AdminNavFlag, boolean>;
}

export interface ResolvedAdminNavigation {
  /** Visible entry ids, in registry order. */
  items: string[];
  actions: string[];
  /** Platform owner block (PLATFORM_NAV). */
  platform: boolean;
  /** Visible sub-page hrefs per entry id (entries with children only). */
  children: Record<string, string[]>;
}

export function canSee(context: Pick<AdminNavContext, 'permissions' | 'isPlatformOwner'>, anyOf: string[]): boolean {
  if (context.isPlatformOwner || context.permissions.includes('*')) return true;
  return anyOf.some((permission) => context.permissions.includes(permission));
}

/** Server-side: which entries this admin may see in this workspace. */
export function resolveAdminNavigation(context: AdminNavContext): ResolvedAdminNavigation {
  const inWorkspace = (workspace: AdminWorkspace | 'all') => workspace === 'all' || workspace === context.workspace;
  return {
    items: ADMIN_NAV
      .filter((item) => inWorkspace(item.workspace) && canSee(context, item.anyOf) && (!item.flag || context.flags[item.flag]))
      .map((item) => item.id),
    actions: ADMIN_QUICK_ACTIONS.filter((action) => inWorkspace(action.workspace) && canSee(context, action.anyOf)).map((action) => action.id),
    platform: context.isPlatformOwner,
    children: Object.fromEntries(ADMIN_NAV
      .filter((item) => item.children && inWorkspace(item.workspace))
      .map((item) => [item.id, item.children!.filter((child) => canSee(context, child.anyOf ?? item.anyOf)).map((child) => child.href)])),
  };
}

export function isHrefActive(pathname: string, href: string, match: 'exact' | 'prefix' = 'prefix'): boolean {
  return match === 'exact' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavItemActive(pathname: string, item: Pick<AdminNavItem, 'href' | 'match' | 'alsoActive'>): boolean {
  return isHrefActive(pathname, item.href, item.match)
    || (item.alsoActive ?? []).some((extra) => isHrefActive(pathname, extra.href, extra.match));
}

/** The child whose href is the longest segment prefix of the path (the product editor stays under « Tous les produits »). */
export function activeNavChild(pathname: string, children: AdminNavChild[]): AdminNavChild | null {
  return children
    .filter((child) => isHrefActive(pathname, child.href))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

/** The entry's sub-pages this admin may see (resolved on the server, see ResolvedAdminNavigation.children). */
export function visibleNavChildren(item: AdminNavItem, visible: Record<string, string[]>): AdminNavChild[] {
  const hrefs = new Set(visible[item.id] ?? []);
  return (item.children ?? []).filter((child) => hrefs.has(child.href));
}

export function navItemsById(ids: string[]): AdminNavItem[] {
  const set = new Set(ids);
  return ADMIN_NAV.filter((item) => set.has(item.id));
}

/** Mobile bottom bar: up to three visible entries flagged `mobile`, by position (+ « Plus »). */
export function mobileNavItems(ids: string[]): AdminNavItem[] {
  return navItemsById(ids).filter((item) => item.mobile !== undefined).sort((a, b) => (a.mobile ?? 0) - (b.mobile ?? 0)).slice(0, 3);
}
