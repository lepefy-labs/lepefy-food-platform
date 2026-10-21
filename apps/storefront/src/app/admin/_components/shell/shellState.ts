import type { AdminNavBadgeKey } from '@/lib/admin/navigation';
import type { AdminWorkspace } from '@/lib/admin/workspace';

export type AdminSearchScope = 'orders' | 'customers' | 'products' | 'events' | 'suppliers' | 'purchases';

/** Serializable navigation model the protected layout resolves on the server. */
export interface AdminShellNav {
  workspace: AdminWorkspace;
  items: string[];
  actions: string[];
  platform: boolean;
  /** Visible sub-page hrefs per entry id (ResolvedAdminNavigation.children). */
  children: Record<string, string[]>;
  badges: Record<AdminNavBadgeKey, number>;
  searchScopes: AdminSearchScope[];
}

export const SIDEBAR_STORAGE_KEY = 'lepefy-admin-sidebar';
/** Side filter column of the list pages (.admin-facets), hidden by the viewer. */
export const FACETS_STORAGE_KEY = 'lepefy-admin-facets';

/**
 * Collapsed desktop rail, driven by html[data-admin-sidebar="collapsed"] so
 * the right width is painted before hydration (no layout jump). Scoped to
 * .admin-sidebar: the mobile drawer reuses the same list fully expanded, and
 * the attribute is harmless outside /admin (nothing else matches it).
 */
export const SHELL_CSS = `
.admin-nav-rail-only { display: none; }
/* Page titles use the display face even on pages without AdminPageHeader. */
#admin-main h1 { font-family: var(--font-display); letter-spacing: -0.01em; }
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
  html[data-admin-sidebar="collapsed"] .admin-sidebar .admin-nav-folded { display: block; }
  /* Folded rail: module sub-pages move to the tab strip above the page (ModuleSubNav). */
  html[data-admin-sidebar="collapsed"] .admin-subnav { display: block; }
}
/*
 * Side filter column of a list page. It needs the room of the page itself, not of
 * the screen (the sidebar may be open or folded), so it depends on a container
 * query on .admin-facets-scope: from 1100px it sits left of the list, below that
 * its filters stay in the FilterBar (views strip .admin-facets-views + « Filtres »).
 * html[data-admin-facets="collapsed"] (viewer's choice) gives the list the whole
 * width and shows « Afficher les filtres » (.admin-facets-show).
 */
.admin-facets-scope { container-type: inline-size; }
html .admin-facets, html .admin-facets-show { display: none; }
@container (min-width: 1100px) {
  html .admin-facets-layout { display: grid; grid-template-columns: 13.5rem minmax(0, 1fr); align-items: start; gap: 1rem; }
  html .admin-facets { display: block; }
  html .admin-facets-scope .admin-facets-views { display: none; }
  html[data-admin-facets="collapsed"] .admin-facets-layout { display: block; }
  html[data-admin-facets="collapsed"] .admin-facets { display: none; }
  html[data-admin-facets="collapsed"] .admin-facets-scope .admin-facets-views { display: flex; }
  html[data-admin-facets="collapsed"] .admin-facets-show { display: inline-flex; }
}
`;

/** Runs before paint (inline script) so the collapsed rail never flashes open. */
export const SIDEBAR_NO_FLASH_SCRIPT = `try{var r=document.documentElement;if(localStorage.getItem('${SIDEBAR_STORAGE_KEY}')==='collapsed')r.setAttribute('data-admin-sidebar','collapsed');if(localStorage.getItem('${FACETS_STORAGE_KEY}')==='collapsed')r.setAttribute('data-admin-facets','collapsed')}catch(e){}`;

/** Shows or hides the side filter column; the choice is kept per viewer. */
export function toggleAdminFacets(collapse: boolean) {
  const root = document.documentElement;
  if (collapse) root.setAttribute('data-admin-facets', 'collapsed'); else root.removeAttribute('data-admin-facets');
  try { window.localStorage.setItem(FACETS_STORAGE_KEY, collapse ? 'collapsed' : 'expanded'); } catch { /* per-viewer convenience */ }
}
