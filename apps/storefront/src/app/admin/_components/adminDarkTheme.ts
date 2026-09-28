/**
 * Admin dark theme, active only while <html> has the `dark` class (set by
 * AdminThemeProvider inside the protected admin; the storefront never gets it).
 *
 * 1. Dark values for the admin CSS tokens.
 * 2. A low-specificity safety net for legacy pages written without `dark:`
 *    variants. Every selector is wrapped in `:where(.dark)`, so it has the
 *    same specificity as the Tailwind utility it maps and wins only by source
 *    order (this <style> is emitted after the Tailwind stylesheet). Explicit
 *    `dark:` utilities (`:is(.dark *)`, one class more) always take precedence,
 *    so components that already define their dark look are unaffected.
 *
 * To keep an element intentionally light (logo, QR code), give it an explicit
 * `dark:bg-white`.
 */

const esc = (cls: string) => cls.replace(/[/:[\]().#%]/g, (ch) => `\\${ch}`);

const GRAY = {
  950: '3 7 18', 900: '17 24 39', 800: '31 41 55', 700: '55 65 81',
  600: '75 85 99', 500: '107 114 128', 400: '156 163 175', 300: '209 213 219', 200: '229 231 235', 100: '243 244 246',
} as const;

// Tailwind 500 / 300 shades of the tinted colours used by legacy admin pages.
const TINTS: Record<string, { base: string; light: string }> = {
  red: { base: '239 68 68', light: '252 165 165' },
  rose: { base: '244 63 94', light: '253 164 175' },
  orange: { base: '249 115 22', light: '253 186 116' },
  amber: { base: '245 158 11', light: '252 211 77' },
  yellow: { base: '234 179 8', light: '253 224 71' },
  green: { base: '34 197 94', light: '134 239 172' },
  emerald: { base: '16 185 129', light: '110 231 183' },
  teal: { base: '20 184 166', light: '94 234 212' },
  sky: { base: '14 165 233', light: '125 211 252' },
  blue: { base: '59 130 246', light: '147 197 253' },
  indigo: { base: '99 102 241', light: '165 180 252' },
  violet: { base: '139 92 246', light: '196 181 253' },
  purple: { base: '168 85 247', light: '216 180 254' },
};

const rule = (selectors: string[], body: string) =>
  `${selectors.map((s) => `:where(.dark) ${s}`).join(',')}{${body}}`;
const cls = (name: string, suffix = '') => `.${esc(name)}${suffix}`;

function buildSafetyNet(): string {
  const out: string[] = [];

  // Surfaces
  out.push(rule([cls('bg-white')], `background-color:rgb(${GRAY[900]})`));
  for (const alpha of ['95', '90', '80', '70', '60', '50']) {
    out.push(rule([cls(`bg-white/${alpha}`)], `background-color:rgb(${GRAY[900]} / .${alpha})`));
  }
  out.push(rule([cls('bg-gray-50'), cls('bg-gray-50/50'), cls('bg-gray-50/60'), cls('bg-gray-50/80')], `background-color:rgb(${GRAY[800]} / .45)`));
  out.push(rule([cls('bg-gray-100')], `background-color:rgb(${GRAY[800]})`));
  out.push(rule([cls('bg-gray-200')], `background-color:rgb(${GRAY[700]})`));
  out.push(rule(
    [cls('hover:bg-white', ':hover'), cls('hover:bg-gray-50', ':hover'), cls('hover:bg-gray-100', ':hover')],
    `background-color:rgb(${GRAY[800]})`,
  ));

  // Text (dark greys inherited from light mode)
  out.push(rule([cls('text-gray-950'), cls('text-gray-900'), cls('text-black')], `color:rgb(${GRAY[100]})`));
  out.push(rule([cls('text-gray-800')], `color:rgb(${GRAY[200]})`));
  out.push(rule([cls('text-gray-700')], `color:rgb(${GRAY[300]})`));
  out.push(rule([cls('text-gray-600'), cls('text-gray-500')], `color:rgb(${GRAY[400]})`));
  out.push(rule([cls('hover:text-gray-900', ':hover'), cls('hover:text-gray-950', ':hover'), cls('hover:text-gray-700', ':hover')], `color:rgb(${GRAY[100]})`));

  // Borders and dividers
  const divide = (name: string) => `${cls(name)} > :not([hidden]) ~ :not([hidden])`;
  out.push(rule([cls('border-gray-100'), cls('border-gray-200'), cls('border-[#E8E4FF]'), cls('border-[#D9D3FF]')], `border-color:rgb(${GRAY[800]})`));
  out.push(rule([cls('border-gray-300')], `border-color:rgb(${GRAY[700]})`));
  out.push(rule([divide('divide-gray-100'), divide('divide-gray-200')], `border-color:rgb(${GRAY[800]})`));
  out.push(rule([cls('ring-[#D9D3FF]'), cls('ring-gray-200')], `--tw-ring-color:rgb(139 92 246 / .3)`));

  // Tinted status surfaces and their text
  for (const [name, { base, light }] of Object.entries(TINTS)) {
    out.push(rule(['', '/80', '/70', '/60', '/50', '/40', '/30'].map((a) => cls(`bg-${name}-50${a}`)), `background-color:rgb(${base} / .12)`));
    out.push(rule([cls(`bg-${name}-100`), cls(`bg-${name}-100/80`), cls(`bg-${name}-100/60`)], `background-color:rgb(${base} / .2)`));
    out.push(rule([cls(`border-${name}-100`), cls(`border-${name}-200`), cls(`border-${name}-300`)], `border-color:rgb(${base} / .35)`));
    out.push(rule(
      ['600', '700', '800', '900', '950', '700/80', '800/80', '800/70', '900/80'].map((shade) => cls(`text-${name}-${shade}`)),
      `color:rgb(${light})`,
    ));
  }

  // Platform colour tokens used as text / outline colours (their background
  // use, e.g. primary buttons with white text, is intentionally unchanged).
  out.push(rule(
    [cls('text-[var(--color-primary-dark)]'), cls('text-[var(--color-primary)]'), cls('text-[var(--admin-primary)]'), cls('hover:text-[var(--color-primary)]', ':hover')],
    'color:rgb(196 181 253)',
  ));
  out.push(rule([cls('border-[var(--color-primary-dark)]')], 'border-color:rgb(167 139 250)'));

  return out.join('\n');
}

export const ADMIN_DARK_CSS = `
:root.dark {
  color-scheme: dark;
  --admin-primary-soft: rgb(139 92 246 / .16);
  --admin-primary-fg: rgb(196 181 253);
  --admin-surface: rgb(${GRAY[900]});
  --admin-surface-subtle: rgb(${GRAY[800]} / .45);
  --admin-page-bg: rgb(${GRAY[950]});
  --admin-border: rgb(${GRAY[800]});
  --color-primary-light: rgb(139 92 246 / .16);
}
${buildSafetyNet()}
`;
