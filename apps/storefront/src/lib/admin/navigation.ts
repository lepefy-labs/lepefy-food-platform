import {
  IconBrandWhatsapp, IconBriefcase, IconBuildingWarehouse, IconCalendarEvent, IconCash, IconChartBar, IconCreditCard,
  IconFileInvoice, IconFileText, IconGift, IconLayoutDashboard, IconMessageCircle, IconPackage, IconPackages, IconPhoto,
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

export type AdminNavGroup = 'Boutique' | 'Opérations' | 'Croissance' | 'Canaux' | 'Gestion' | 'Événementiel' | 'Service sur place' | 'Commun';
export type AdminNavFlag = 'gestion' | 'whatsapp';
export type AdminNavBadgeKey = 'pendingPayments' | 'pendingEventRequests' | 'newInquiries' | 'pendingRentalRequests';

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

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = ['Boutique', 'Opérations', 'Croissance', 'Canaux', 'Gestion', 'Événementiel', 'Service sur place', 'Commun'];

export const ADMIN_NAV: AdminNavItem[] = [
  // Boutique
  { id: 'orders', label: 'Commandes', href: '/admin', icon: IconShoppingBag, group: 'Boutique', workspace: 'shop', anyOf: ['orders.view'], match: 'exact', alsoActive: [{ href: '/admin/orders' }, { href: '/admin/paiements-en-attente' }], badge: { key: 'pendingPayments', tone: 'warning', label: 'paiements à vérifier' }, mobile: 1, keywords: ['ordres', 'préparation', 'expédition', 'précommandes'] },
  { id: 'card-payments', label: 'Paiements carte', href: '/admin/paiements-carte', icon: IconCreditCard, group: 'Boutique', workspace: 'shop', anyOf: ['orders.view'], keywords: ['stripe', 'cp-'] },
  { id: 'checkout-funnel', label: 'Funnel checkout', href: '/admin/checkout-funnel', icon: IconChartBar, group: 'Boutique', workspace: 'shop', anyOf: ['orders.view'], match: 'exact', keywords: ['conversion', 'abandon'] },
  { id: 'catalogue', label: 'Catalogue', href: '/admin/catalogue', icon: IconPackage, group: 'Boutique', workspace: 'shop', anyOf: ['catalog.view'], alsoActive: [{ href: '/admin/products' }], mobile: 2, keywords: ['produits', 'stock', 'prix', 'catégories'] },
  { id: 'customers', label: 'Clients', href: '/admin/clients', icon: IconUsers, group: 'Boutique', workspace: 'shop', anyOf: ['customers.view'], keywords: ['crm', 'segments', 'campagnes'] },
  { id: 'home-slides', label: 'Slides d’accueil', href: '/admin/accueil-slides', icon: IconPhoto, group: 'Boutique', workspace: 'shop', anyOf: ['catalog.manage'], match: 'exact', keywords: ['bannière', 'hero'] },
  // Opérations
  { id: 'loyalty-scan', label: 'Scan fidélité', href: '/admin/loyalty/scan', icon: IconScan, group: 'Opérations', workspace: 'shop', anyOf: ['loyalty.scan'], match: 'exact', mobile: 3, keywords: ['carte', 'caisse', 'points'] },
  { id: 'shipping', label: 'Livraison', href: '/admin/livraison', icon: IconTruck, group: 'Opérations', workspace: 'shop', anyOf: ['shipping.view'], keywords: ['packlink', 'zones', 'tarifs', 'expéditions', 'emballages'] },
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
  // Commun
  { id: 'public-content', label: 'Contenu public', href: '/admin/contenu', icon: IconFileText, group: 'Commun', workspace: 'all', anyOf: ['tenant_settings.view'], keywords: ['notre origine', 'histoire'] },
  { id: 'tools', label: 'Outils & QR', href: '/admin/outils', icon: IconQrcode, group: 'Commun', workspace: 'all', anyOf: ['tenant_settings.view'], keywords: ['affiche', 'qr code'] },
  { id: 'settings', label: 'Paramètres', href: '/admin/parametres', icon: IconSettings, group: 'Commun', workspace: 'all', anyOf: ['tenant_settings.view'], keywords: ['réglages', 'configuration', 'notifications'] },
  { id: 'billing', label: 'Abonnement', href: '/admin/billing', icon: IconCreditCard, group: 'Commun', workspace: 'all', anyOf: ['billing.view'], match: 'exact', keywords: ['facture'] },
  { id: 'ai-usage', label: 'Utilisation IA', href: '/admin/ai-usage', icon: IconChartBar, group: 'Commun', workspace: 'all', anyOf: ['ai_usage.view'], match: 'exact' },
];

export const ADMIN_QUICK_ACTIONS: AdminQuickAction[] = [
  { id: 'new-order', label: 'Nouvelle commande', href: '/admin/orders/new', icon: IconPlus, workspace: 'shop', anyOf: ['orders.manage'], keywords: ['précommande', 'whatsapp', 'téléphone'] },
  { id: 'new-product', label: 'Nouveau produit', href: '/admin/catalogue/nouveau', icon: IconPlus, workspace: 'shop', anyOf: ['catalog.manage'] },
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
  };
}

export function isHrefActive(pathname: string, href: string, match: 'exact' | 'prefix' = 'prefix'): boolean {
  return match === 'exact' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function isNavItemActive(pathname: string, item: Pick<AdminNavItem, 'href' | 'match' | 'alsoActive'>): boolean {
  return isHrefActive(pathname, item.href, item.match)
    || (item.alsoActive ?? []).some((extra) => isHrefActive(pathname, extra.href, extra.match));
}

export function navItemsById(ids: string[]): AdminNavItem[] {
  const set = new Set(ids);
  return ADMIN_NAV.filter((item) => set.has(item.id));
}

/** Mobile bottom bar: up to three visible entries flagged `mobile`, by position. */
export function mobileNavItems(ids: string[]): AdminNavItem[] {
  return navItemsById(ids).filter((item) => item.mobile !== undefined).sort((a, b) => (a.mobile ?? 0) - (b.mobile ?? 0)).slice(0, 3);
}
