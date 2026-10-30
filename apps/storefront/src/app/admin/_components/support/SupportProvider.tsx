'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { SupportCategory } from '@/lib/support/domain';
import SupportComposer from './SupportComposer';

/**
 * Assistance entry point mounted once in the protected admin layout (flag
 * support_assistance on and capability support.use): every admin page can open
 * the quick panel without leaving the page. Nothing is fetched until it opens.
 */
interface SupportApi {
  enabled: boolean;
  /** Lepefy account previewing the shop: reading only. */
  readOnly: boolean;
  unread: number;
  open: (options?: { category?: Exclude<SupportCategory, 'unspecified'>; text?: string; helpArticle?: string }) => void;
}

const SupportContext = createContext<SupportApi>({ enabled: false, readOnly: true, unread: 0, open: () => {} });
export const useSupport = () => useContext(SupportContext);

export default function SupportProvider({ enabled, readOnly, unread, pageLabels, children }: {
  enabled: boolean;
  readOnly: boolean;
  unread: number;
  /** Page names offered in « Changer » (visible navigation of this admin). */
  pageLabels: string[];
  children: ReactNode;
}) {
  const pathname = usePathname() ?? '/admin';
  const [state, setState] = useState<{ open: boolean; pathname: string; category: SupportCategory | null; text: string | null; helpArticle: string | null; session: number }>(
    { open: false, pathname: '/admin', category: null, text: null, helpArticle: null, session: 0 },
  );
  const open = useCallback<SupportApi['open']>((options) => {
    setState((current) => ({ open: true, pathname, category: options?.category ?? null, text: options?.text ?? null, helpArticle: options?.helpArticle ?? null, session: current.session + 1 }));
  }, [pathname]);
  const api = useMemo(() => ({ enabled, readOnly, unread, open }), [enabled, readOnly, unread, open]);

  return (
    <SupportContext.Provider value={api}>
      {children}
      {enabled && (
        <SupportComposer
          key={state.session}
          open={state.open}
          onClose={() => setState((current) => ({ ...current, open: false }))}
          pathname={state.pathname}
          initialCategory={state.category}
          initialText={state.text}
          pageLabels={pageLabels}
          readOnly={readOnly}
          helpArticle={state.helpArticle}
        />
      )}
    </SupportContext.Provider>
  );
}
