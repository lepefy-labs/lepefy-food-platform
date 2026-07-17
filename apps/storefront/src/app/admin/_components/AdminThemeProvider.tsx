'use client';

import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext<{ dark: boolean; toggle: () => void }>({
  dark: false,
  toggle: () => {},
});

export function useAdminTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = 'lepefy-admin-theme';

export default function AdminThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Al primo render dark è sempre false finché useEffect non legge
  // localStorage: evita il mismatch di idratazione SSR/client. Il breve
  // flash chiaro→scuro è accettabile per un pannello dietro login.
  useEffect(() => {
    setMounted(true);
    if (localStorage.getItem(STORAGE_KEY) === 'dark') setDark(true);
  }, []);

  useEffect(() => {
    if (mounted) localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light');
  }, [dark, mounted]);

  return (
    <ThemeContext.Provider value={{ dark, toggle: () => setDark(d => !d) }}>
      <div className={dark ? 'dark' : ''}>{children}</div>
    </ThemeContext.Provider>
  );
}
