'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useSupport } from '../support/SupportProvider';
import HelpDrawer from './HelpDrawer';

/**
 * Help Center entry point, mounted once in the protected admin layout when the
 * tenant has the module (entitlement + help.view). It never opens by itself:
 * only a click (header button, menu, palette, « Aide » link) opens the drawer,
 * and nothing is fetched until then. Independent from Assistance: the support
 * tab only appears when the Assistance provider says it is available.
 */
interface HelpApi {
  enabled: boolean;
  open: (options?: { slug?: string }) => void;
}

const HelpContext = createContext<HelpApi>({ enabled: false, open: () => {} });
export const useHelp = () => useContext(HelpContext);

export default function HelpProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const pathname = usePathname() ?? '/admin';
  const support = useSupport();
  const [state, setState] = useState<{ open: boolean; pathname: string; slug: string | null; session: number }>({ open: false, pathname: '/admin', slug: null, session: 0 });
  const open = useCallback<HelpApi['open']>((options) => {
    setState((current) => ({ open: true, pathname, slug: options?.slug ?? null, session: current.session + 1 }));
  }, [pathname]);
  const api = useMemo(() => ({ enabled, open }), [enabled, open]);
  const supportAvailable = support.enabled && !support.readOnly;

  return (
    <HelpContext.Provider value={api}>
      {children}
      {enabled && state.session > 0 && (
        <HelpDrawer
          key={state.session}
          open={state.open}
          onClose={() => setState((current) => ({ ...current, open: false }))}
          pathname={state.pathname}
          initialSlug={state.slug}
          supportAvailable={supportAvailable}
          onContactSupport={(helpArticle) => { setState((current) => ({ ...current, open: false })); support.open({ category: 'question', helpArticle }); }}
        />
      )}
    </HelpContext.Provider>
  );
}
