import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        'primary-light': 'var(--color-primary-light)',
        secondary: 'var(--color-secondary)',
        // Admin Design System V2 (lib/admin/tokens.ts): defined only inside
        // /admin, light on :root and dark on :root.dark — no dark: variants.
        a: {
          bg: 'var(--admin-page-bg)',
          surface: 'var(--admin-surface)',
          'surface-2': 'var(--admin-surface-subtle)',
          border: 'var(--admin-border)',
          'border-strong': 'var(--admin-border-strong)',
          text: 'var(--admin-text)',
          'text-2': 'var(--admin-text-2)',
          'text-3': 'var(--admin-text-3)',
          hover: 'var(--admin-hover)',
          selected: 'var(--admin-selected)',
          focus: 'var(--admin-focus)',
          brand: 'var(--admin-primary)',
          'brand-hover': 'var(--admin-primary-hover)',
          'brand-soft': 'var(--admin-primary-soft)',
          'brand-fg': 'var(--admin-primary-fg)',
          'on-brand': 'var(--admin-on-primary)',
          'disabled-bg': 'var(--admin-disabled-bg)',
          'disabled-fg': 'var(--admin-disabled-fg)',
          inverse: 'var(--admin-inverse-bg)',
          'on-inverse': 'var(--admin-inverse-fg)',
        },
        tone: Object.fromEntries(
          ['info', 'success', 'warning', 'urgent', 'danger', 'neutral'].flatMap((tone) =>
            ['bg', 'fg', 'border', 'solid'].map((part) => [`${tone}-${part}`, `var(--admin-tone-${tone}-${part})`]),
          ),
        ),
      },
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
      },
      /* Un seul step ajouté à l'échelle par défaut de Tailwind (xs=12/sm=14/
         base=16/lg=18/xl=20/...) pour couvrir les libellés/badges les plus
         petits — les text-[Npx] arbitraires migrent vers ce vocabulaire fini
         plutôt que d'en générer un nouveau par valeur trouvée. */
      fontSize: {
        '2xs': ['10px', { lineHeight: '1.3' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
};

export default config;
