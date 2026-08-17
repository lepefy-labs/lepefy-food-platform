import type { Config } from 'tailwindcss';

/**
 * Isolated Tailwind config for the TailAdmin porting staging area only.
 * Referenced via `@config` from `src/_tailadmin-staging/styles/globals.css` —
 * NOT wired into the production build. Do not import this from the app's
 * real `tailwind.config.ts`.
 *
 * Tokens below are extracted verbatim from TailAdmin v2.3.0's
 * `src/app/globals.css` `@theme` block (Tailwind v4 CSS-first config) and
 * translated to the classic v3 `theme.extend` shape.
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './src/_tailadmin-staging/**/*.{ts,tsx}',
    './src/app/admin/(protected)/_staging-preview/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // TODO: derivare da tenant (tenant.primary_color) — per ora placeholder
      // brand del template TailAdmin, non ancora collegato al sistema
      // multi-tenant. Vedi CLAUDE.md "Multi-Tenancy".
      colors: {
        brand: {
          25: '#f2f7ff',
          50: '#ecf3ff',
          100: '#dde9ff',
          200: '#c2d6ff',
          300: '#9cb9ff',
          400: '#7592ff',
          500: '#465fff',
          600: '#3641f5',
          700: '#2a31d8',
          800: '#252dae',
          900: '#262e89',
          950: '#161950',
        },
        'blue-light': {
          25: '#f5fbff',
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#b9e6fe',
          300: '#7cd4fd',
          400: '#36bffa',
          500: '#0ba5ec',
          600: '#0086c9',
          700: '#026aa2',
          800: '#065986',
          900: '#0b4a6f',
          950: '#062c41',
        },
        // Palette gray dédiée du template (proche mais distincte du gray
        // Tailwind par défaut) — isolée à ce config, n'affecte pas le reste
        // de l'app qui reste sur tailwind.config.ts.
        gray: {
          25: '#fcfcfd',
          50: '#f9fafb',
          100: '#f2f4f7',
          200: '#e4e7ec',
          300: '#d0d5dd',
          400: '#98a2b3',
          500: '#667085',
          600: '#475467',
          700: '#344054',
          800: '#1d2939',
          900: '#101828',
          950: '#0c111d',
          dark: '#1a2231',
        },
        orange: {
          25: '#fffaf5',
          50: '#fff6ed',
          100: '#ffead5',
          200: '#fddcab',
          300: '#feb273',
          400: '#fd853a',
          500: '#fb6514',
          600: '#ec4a0a',
          700: '#c4320a',
          800: '#9c2a10',
          900: '#7e2410',
          950: '#511c10',
        },
        success: {
          25: '#f6fef9',
          50: '#ecfdf3',
          100: '#d1fadf',
          200: '#a6f4c5',
          300: '#6ce9a6',
          400: '#32d583',
          500: '#12b76a',
          600: '#039855',
          700: '#027a48',
          800: '#05603a',
          900: '#054f31',
          950: '#053321',
        },
        error: {
          25: '#fffbfa',
          50: '#fef3f2',
          100: '#fee4e2',
          200: '#fecdca',
          300: '#fda29b',
          400: '#f97066',
          500: '#f04438',
          600: '#d92d20',
          700: '#b42318',
          800: '#912018',
          900: '#7a271a',
          950: '#55160c',
        },
        warning: {
          25: '#fffcf5',
          50: '#fffaeb',
          100: '#fef0c7',
          200: '#fedf89',
          300: '#fec84b',
          400: '#fdb022',
          500: '#f79009',
          600: '#dc6803',
          700: '#b54708',
          800: '#93370d',
          900: '#7a2e0e',
          950: '#4e1d09',
        },
        theme: {
          pink: { 500: '#ee46bc' },
          purple: { 500: '#7a5af8' },
        },
      },
      // Outfit n'est pas installé dans ce cycle (pas de nouvelle dépendance
      // de police hors périmètre) — fallback sur la pile système, le rendu
      // visuel exact du template nécessitera d'ajouter @fontsource/outfit
      // dans un cycle ultérieur si on veut le porter tel quel.
      fontFamily: {
        outfit: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      screens: {
        '2xsm': '375px',
        xsm: '425px',
        '3xl': '2000px',
      },
      fontSize: {
        'title-2xl': ['72px', { lineHeight: '90px' }],
        'title-xl': ['60px', { lineHeight: '72px' }],
        'title-lg': ['48px', { lineHeight: '60px' }],
        'title-md': ['36px', { lineHeight: '44px' }],
        'title-sm': ['30px', { lineHeight: '38px' }],
        'theme-xl': ['20px', { lineHeight: '30px' }],
        'theme-sm': ['14px', { lineHeight: '20px' }],
        'theme-xs': ['12px', { lineHeight: '18px' }],
      },
      spacing: {
        // Seule valeur utilisée par les composants portés absente de
        // l'échelle par défaut de Tailwind v3 (v4 génère 0.25rem*N pour
        // n'importe quel N, v3 non).
        '4.5': '1.125rem',
      },
      // Tailwind v4 accepte `ring-3` (échelle numérique ouverte) ; v3 a une
      // échelle fixe (0/1/2/4/8) — ajout explicite du seul écart trouvé.
      ringWidth: {
        3: '3px',
      },
      boxShadow: {
        'theme-md':
          '0px 4px 8px -2px rgba(16, 24, 40, 0.1), 0px 2px 4px -2px rgba(16, 24, 40, 0.06)',
        'theme-lg':
          '0px 12px 16px -4px rgba(16, 24, 40, 0.08), 0px 4px 6px -2px rgba(16, 24, 40, 0.03)',
        'theme-sm':
          '0px 1px 3px 0px rgba(16, 24, 40, 0.1), 0px 1px 2px 0px rgba(16, 24, 40, 0.06)',
        'theme-xs': '0px 1px 2px 0px rgba(16, 24, 40, 0.05)',
        'theme-xl':
          '0px 20px 24px -4px rgba(16, 24, 40, 0.08), 0px 8px 8px -4px rgba(16, 24, 40, 0.03)',
      },
      zIndex: {
        1: '1',
        9: '9',
        99: '99',
        999: '999',
        9999: '9999',
        99999: '99999',
        999999: '999999',
      },
    },
  },
  plugins: [],
};

export default config;
