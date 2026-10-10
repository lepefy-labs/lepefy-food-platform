import { isHrefActive } from '@/lib/admin/navigation';
import { IconBell, IconBrandWhatsapp, IconBriefcase, IconReceipt, IconDeviceMobile, IconSettings, IconShieldLock, IconSparkles, IconTruck, type Icon } from '@tabler/icons-react';

/**
 * Platform-owner navigation, single source of truth for the sidebar groups and
 * the in-page section tabs. Adding a platform page = adding an entry here.
 */
export interface PlatformNavItem {
  label: string;
  href: string;
  /** 'prefix' (default) also marks sub-pages as active. */
  match?: 'exact' | 'prefix';
}

export interface PlatformNavGroup {
  id: string;
  label: string;
  icon: Icon;
  /** Single-link entry (no children). */
  href?: string;
  match?: 'exact' | 'prefix';
  children?: PlatformNavItem[];
}

export const PLATFORM_NAV: PlatformNavGroup[] = [
  { id: 'console', label: 'Console Lepefy', icon: IconSettings, href: '/admin/platform', match: 'exact' },
  { id: 'subscriptions', label: 'Abonnements', icon: IconReceipt, href: '/admin/platform/abonnements' },
  {
    id: 'access', label: 'Accès', icon: IconShieldLock, children: [
      { label: 'Utilisateurs', href: '/admin/team' },
      { label: 'Rôles & permissions', href: '/admin/platform/access' },
    ],
  },
  {
    id: 'ai', label: 'Intelligence artificielle', icon: IconSparkles, children: [
      { label: 'Routage', href: '/admin/platform/ai-routing' },
      { label: 'Coûts', href: '/admin/platform/ai-usage' },
    ],
  },
  {
    id: 'notifications', label: 'Notifications', icon: IconBell, children: [
      { label: 'Historique', href: '/admin/platform/notifications/historique' },
      { label: 'Modèles', href: '/admin/platform/notifications/modeles' },
      { label: 'Tests', href: '/admin/platform/notifications/tests' },
      { label: 'Transport & santé', href: '/admin/platform/notifications/sante' },
    ],
  },
  { id: 'external-catalogs', label: 'Catalogues WhatsApp', icon: IconBrandWhatsapp, href: '/admin/platform/catalogues-whatsapp' },
  { id: 'mobile-app', label: 'Application mobile', icon: IconDeviceMobile, href: '/admin/platform/application-mobile' },
  {
    id: 'shipping', label: 'Livraison technique', icon: IconTruck, children: [
      { label: 'Laboratoire', href: '/admin/platform/livraison/laboratoire' },
      { label: 'Diagnostic Packlink', href: '/admin/platform/livraison/diagnostic-packlink' },
    ],
  },
  {
    id: 'development', label: 'Développement', icon: IconBriefcase, children: [
      { label: 'Prospects', href: '/admin/platform/prospects' },
      { label: 'Feedback testeurs', href: '/admin/platform/feedback' },
    ],
  },
];

/** Same active-state rule as the main navigation registry. */
export const isNavHrefActive = isHrefActive;

export function isGroupActive(pathname: string, group: PlatformNavGroup) {
  if (group.href) return isNavHrefActive(pathname, group.href, group.match);
  return (group.children ?? []).some((item) => isNavHrefActive(pathname, item.href, item.match));
}

export function platformNavGroup(id: string) {
  return PLATFORM_NAV.find((group) => group.id === id);
}
