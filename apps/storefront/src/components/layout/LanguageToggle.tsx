'use client';

import { useLocaleStore, resolveLocale } from '@/lib/store/localeStore';

export function LanguageToggle({ locales }: { locales: string[] }) {
  const storeLocale = useLocaleStore((s) => s.locale);
  const setLocale    = useLocaleStore((s) => s.setLocale);

  if (locales.length < 2) return null;

  const activeLocale = resolveLocale(storeLocale, locales);

  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-gray-200 bg-white p-0.5 text-xs font-medium">
      {locales.map((locale) => (
        <button
          key={locale}
          onClick={() => setLocale(locale)}
          aria-pressed={activeLocale === locale}
          className={`px-2 py-1 rounded-full transition-colors ${
            activeLocale === locale
              ? 'text-white'
              : 'text-gray-500 hover:text-gray-700'
          }`}
          style={activeLocale === locale ? { backgroundColor: 'var(--color-primary)' } : undefined}
        >
          {locale.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
