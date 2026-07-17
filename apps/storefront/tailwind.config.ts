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
