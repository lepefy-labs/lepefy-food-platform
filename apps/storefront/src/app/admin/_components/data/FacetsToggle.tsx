'use client';

import { IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand } from '@tabler/icons-react';
import { cn } from '@/lib/utils/cn';
import { buttonClasses } from '../ui/Button';
import { toggleAdminFacets } from '../shell/shellState';

/**
 * Hide / show the side filter column (.admin-facets, xl and up). Each button is
 * only visible in the state it changes (CSS on html[data-admin-facets]), so its
 * aria-expanded is constant; focus moves to the counterpart button.
 */
export default function FacetsToggle({ mode, controls }: { mode: 'hide' | 'show'; controls: string }) {
  const hide = mode === 'hide';
  return (
    <button
      type="button"
      id={`${controls}-${mode}`}
      aria-controls={controls}
      aria-expanded={hide}
      title={hide ? 'Masquer les filtres pour agrandir la liste' : 'Afficher les filtres'}
      onClick={() => {
        toggleAdminFacets(hide);
        document.getElementById(`${controls}-${hide ? 'show' : 'hide'}`)?.focus();
      }}
      className={cn(hide ? buttonClasses({ variant: 'ghost', size: 'sm' }) : cn(buttonClasses({ variant: 'secondary', size: 'sm' }), 'admin-facets-show shrink-0'))}
    >
      {hide ? <IconLayoutSidebarLeftCollapse size={16} aria-hidden="true" /> : <IconLayoutSidebarLeftExpand size={16} aria-hidden="true" />}
      <span className="sr-only">{hide ? 'Masquer les filtres' : 'Afficher les filtres'}</span>
    </button>
  );
}
