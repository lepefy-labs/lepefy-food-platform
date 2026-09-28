'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';

const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({
  dark: false,
  toggle: () => {},
});

export function useAdminTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = 'lepefy-admin-theme';

// Runs during HTML parsing, before the admin shell is painted: applies the
// persisted theme to <html> so dark mode never flashes light on load.
const NO_FLASH_SCRIPT = `try{if(localStorage.getItem('${STORAGE_KEY}')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

function readStoredDark(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

// useLayoutEffect warns during SSR; this component only needs it in the browser.
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Admin theme. The `dark` class lives on <html> (Tailwind darkMode: 'class'),
 * so it also covers portals (mobile drawer, modals) rendered into <body>.
 * The render output never depends on localStorage before mount (`null` =
 * not yet known), which keeps server and client markup identical.
 */
export default function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState<boolean | null>(null);

  useIsomorphicLayoutEffect(() => {
    setDark(readStoredDark());
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (dark === null) return;
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  // Leaving the protected admin (login, storefront) must not keep dark mode.
  useEffect(() => () => document.documentElement.classList.remove('dark'), []);

  function toggle() {
    setDark((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
      } catch {
        // Storage unavailable: the choice applies to this page only.
      }
      return next;
    });
  }

  return (
    <ThemeContext.Provider value={{ dark: dark === true, toggle }}>
      <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      {children}
    </ThemeContext.Provider>
  );
}
