import { expect, test } from '@playwright/test';
import {
  BOTTOM_NAV_FALLBACK,
  BOTTOM_NAV_INACTIVE_LABEL,
  BOTTOM_NAV_SEMANTIC_COLORS,
  BOTTOM_NAV_TINT_PERCENT,
  bottomNavAccent,
  ensureContrastOnWhite,
  hueDistance,
  MIN_HUE_DISTANCE,
  resolveBottomNavPalette,
  resolveNavigationPalette,
} from '../../src/lib/storefront/bottomNavTheme';
import { contrastRatio } from '../../src/lib/utils/color';

/** Couleur de la pastille active (`color-mix(in srgb, X p%, white)`), calculée comme le navigateur. */
function tintOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c * BOTTOM_NAV_TINT_PERCENT / 100 + 255 * (1 - BOTTOM_NAV_TINT_PERCENT / 100));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
}

test.describe('couleurs de la BottomNav', () => {
  test('chaque destination est lisible en texte sur blanc et sur sa pastille active', () => {
    for (const [destination, color] of Object.entries(BOTTOM_NAV_SEMANTIC_COLORS)) {
      expect(contrastRatio(color, '#ffffff'), destination).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color, tintOf(color)), destination).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(BOTTOM_NAV_INACTIVE_LABEL, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  test('les destinations restent distinctes entre elles', () => {
    const colors = Object.values(BOTTOM_NAV_SEMANTIC_COLORS);
    expect(new Set(colors).size).toBe(colors.length);
  });

  test('le panier prend la couleur du tenant, assombrie si elle est trop claire', () => {
    expect(bottomNavAccent('cart', '#1565C0')).toBe('#1565c0');
    expect(bottomNavAccent('cart', '#0b1f3a')).toBe('#0b1f3a');
    for (const light of ['#FFD400', '#7ED957', '#F9A8D4', '#fff']) {
      const accent = bottomNavAccent('cart', light);
      expect(contrastRatio(accent, '#ffffff'), light).toBeGreaterThanOrEqual(4.5);
      // Une couleur claire mais teintée garde sa teinte (le blanc pur n'en a pas).
      if (light !== '#fff') expect(accent, light).not.toBe(BOTTOM_NAV_FALLBACK);
    }
    // Jaune : même teinte, plus sombre — pas remplacé par du gris.
    const yellow = bottomNavAccent('cart', '#FFD400');
    expect(parseInt(yellow.slice(1, 3), 16)).toBeGreaterThan(parseInt(yellow.slice(5, 7), 16));
  });

  test('une couleur invalide retombe sur le repli neutre', () => {
    expect(ensureContrastOnWhite(null)).toBe(BOTTOM_NAV_FALLBACK);
    expect(ensureContrastOnWhite('rouge')).toBe(BOTTOM_NAV_FALLBACK);
    expect(bottomNavAccent('catalog', '#FFD400')).toBe(BOTTOM_NAV_SEMANTIC_COLORS.catalog);
  });

  test('tenant bleu : Catalogue quitte le bleu pour ne pas se confondre avec le panier', () => {
    const palette = resolveBottomNavPalette('#1267C7');
    expect(palette.cart).toBe('#1267c7');
    expect(palette.catalog).not.toBe(BOTTOM_NAV_SEMANTIC_COLORS.catalog);
    expect(palette.discover).toBe(BOTTOM_NAV_SEMANTIC_COLORS.discover);
    expect(hueDistance(palette.catalog, palette.cart)).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
  });

  test('quelle que soit la teinte du tenant, le panier ne se confond avec aucune destination et tout reste lisible', () => {
    for (let hue = 0; hue < 360; hue += 15) {
      // Couleur saturée de teinte donnée (HSL s=70 %, l=40 %).
      const f = (n: number) => { const k = (n + hue / 30) % 12; const a = 0.7 * Math.min(0.4, 0.6); return Math.round(255 * (0.4 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      const tenant = `#${[f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      const palette = resolveBottomNavPalette(tenant);
      for (const [destination, color] of Object.entries(palette)) {
        expect(contrastRatio(color, '#ffffff'), `${tenant} ${destination}`).toBeGreaterThanOrEqual(4.5);
        // L'ardoise (#475569) est quasi neutre : elle ne se confond avec aucune teinte.
        if (destination !== 'cart' && color !== '#475569') expect(hueDistance(color, palette.cart), `${tenant} ${destination}`).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
      }
      expect(new Set(Object.values(palette)).size, tenant).toBe(5);
      // Deux à deux, les destinations colorées ne se confondent pas.
      const saturated = Object.entries(palette).filter(([, c]) => !['#475569', '#111827'].includes(c));
      for (const [i, [da, a]] of saturated.entries()) {
        for (const [db, b] of saturated.slice(i + 1)) expect(hueDistance(a, b), `${tenant} ${da}/${db}`).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
      }
    }
  });

  test('tenant neutre (gris, noir) : couleurs sémantiques inchangées', () => {
    const palette = resolveBottomNavPalette('#222222');
    expect(palette.catalog).toBe(BOTTOM_NAV_SEMANTIC_COLORS.catalog);
    expect(palette.account).toBe(BOTTOM_NAV_SEMANTIC_COLORS.account);
  });

  test('menu : sept rôles lisibles et distincts pour toute teinte de tenant, mêmes couleurs que la barre', () => {
    const neutrals = ['#475569', '#57534e', '#111827'];
    for (let hue = 0; hue < 360; hue += 15) {
      const f = (n: number) => { const k = (n + hue / 30) % 12; return Math.round(255 * (0.4 - 0.28 * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      const tenant = '#' + [f(0), f(8), f(4)].map((c) => c.toString(16).padStart(2, '0')).join('');
      const menu = resolveNavigationPalette(tenant);
      const bar = resolveBottomNavPalette(tenant);
      for (const key of Object.keys(bar) as Array<keyof typeof bar>) expect(menu[key], tenant + ' ' + key).toBe(bar[key]);
      const entries = Object.entries(menu);
      for (const [role, color] of entries) expect(contrastRatio(color, '#ffffff'), tenant + ' ' + role).toBeGreaterThanOrEqual(4.5);
      const saturated = entries.filter(([, c]) => !neutrals.includes(c));
      for (const [i, [ra, a]] of saturated.entries()) {
        for (const [rb, b] of saturated.slice(i + 1)) expect(hueDistance(a, b), tenant + ' ' + ra + '/' + rb).toBeGreaterThanOrEqual(MIN_HUE_DISTANCE);
      }
    }
  });
});
