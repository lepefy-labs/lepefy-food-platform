import type { AdminNavBadgeKey } from '@/lib/admin/navigation';
import type { AdminWorkspace } from '@/lib/admin/workspace';

export type AdminSearchScope = 'orders' | 'customers' | 'products' | 'events' | 'suppliers' | 'purchases';

/** Serializable navigation model the protected layout resolves on the server. */
export interface AdminShellNav {
  workspace: AdminWorkspace;
  items: string[];
  actions: string[];
  platform: boolean;
  badges: Record<AdminNavBadgeKey, number>;
  searchScopes: AdminSearchScope[];
}

export const SIDEBAR_STORAGE_KEY = 'lepefy-admin-sidebar';

/**
 * Collapsed desktop rail, driven by html[data-admin-sidebar="collapsed"] so
 * the right width is painted before hydration (no layout jump). Scoped to
 * .admin-sidebar: the mobile drawer reuses the same list fully expanded, and
 * the attribute is harmless outside /admin (nothing else matches it).
 */
export const SHELL_CSS = `
.admin-nav-rail-only { display: none; }
@media (min-width: 768px) {
  html[data-admin-sidebar="collapsed"] .admin-sidebar { width: 4rem; }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-label,
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-group,
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-children {
    position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap;
  }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-item { justify-content: center; padding-left: 0; padding-right: 0; }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-count { position: absolute; top: 6px; right: 10px; display: flex; }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-count > span { min-width: 0; width: 0.5rem; height: 0.5rem; padding: 0; font-size: 0; line-height: 0; background: currentColor; }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-separator { display: block; }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-collapse-icon { transform: rotate(180deg); }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-rail-only { display: flex; }
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-full-only { display: none; }
}
`;

/** Runs before paint (inline script) so the collapsed rail never flashes open. */
export const SIDEBAR_NO_FLASH_SCRIPT = `try{if(localStorage.getItem('${SIDEBAR_STORAGE_KEY}')==='collapsed')document.documentElement.setAttribute('data-admin-sidebar','collapsed')}catch(e){}`;
