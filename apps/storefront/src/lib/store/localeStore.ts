import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LocaleState {
  /** null = usa il default tenant (tenantLocales[0]) */
  locale: string | null;
  setLocale: (l: string) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: null,
      setLocale(l) { set({ locale: l }); },
    }),
    { name: 'lepefy-locale' },
  ),
);

/**
 * Risolve il locale attivo: usa quello persistito se valido per il tenant,
 * altrimenti ricade sul primo locale del tenant.
 */
export function resolveLocale(storeLocale: string | null, tenantLocales: string[]): string {
  if (storeLocale && tenantLocales.includes(storeLocale)) return storeLocale;
  return tenantLocales[0] ?? '';
}
