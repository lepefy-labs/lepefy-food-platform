import { contrastRatio, mixWithBlack } from '@/lib/utils/color';

/**
 * Couleurs de la BottomNav : une couleur par destination pour la reconnaître
 * d'un coup d'œil (jamais la seule marque de l'état actif). Plateforme, pas
 * tenant — sauf le panier, qui prend la couleur principale de la boutique.
 * Toutes lisibles en texte sur blanc (≥ 4.5:1) : icônes et libellé actif.
 */
export type BottomNavDestination = 'discover' | 'catalog' | 'cart' | 'goodies' | 'account';

export const BOTTOM_NAV_SEMANTIC_COLORS: Record<Exclude<BottomNavDestination, 'cart'>, string> = {
  /** Vert pétrole. */
  discover: '#0f766e',
  /** Bleu. */
  catalog: '#1d4ed8',
  /** Ambre (assombri pour rester lisible sur blanc). */
  goodies: '#b45309',
  /** Violet désaturé. */
  account: '#6b5b95',
};

/** Libellé d'une destination inactive : neutre, lisible (≥ 4.5:1). */
export const BOTTOM_NAV_INACTIVE_LABEL = '#374151';
/** Repli quand la couleur du tenant est invalide ou impossible à rendre lisible. */
export const BOTTOM_NAV_FALLBACK = '#111827';
/** Part de la couleur dans la pastille de la destination active (reste du blanc). */
export const BOTTOM_NAV_TINT_PERCENT = 14;

function normalizeHex(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return null;
  const hex = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return hex.length === 4 ? `#${hex.slice(1).split('').map((c) => c + c).join('')}` : hex.toLowerCase();
}

/**
 * Couleur lisible sur blanc qui garde la teinte : une couleur de tenant trop
 * claire (jaune, vert pâle) est assombrie par paliers plutôt que remplacée
 * par du gris ; invalide → repli neutre.
 */
export function ensureContrastOnWhite(color: string | null | undefined, minimum = 4.5, fallback = BOTTOM_NAV_FALLBACK): string {
  const hex = normalizeHex(color);
  if (!hex) return fallback;
  if (contrastRatio(hex, '#ffffff') >= minimum) return hex;
  for (let percent = 90; percent >= 30; percent -= 5) {
    const darker = mixWithBlack(hex, percent);
    if (contrastRatio(darker, '#ffffff') >= minimum) return darker;
  }
  return fallback;
}

/** Couleur d'une destination ; le panier dérive de la couleur principale du tenant. */
export function bottomNavAccent(destination: BottomNavDestination, tenantPrimary: string | null | undefined): string {
  return resolveBottomNavPalette(tenantPrimary)[destination];
}

/**
 * Candidates par destination, toutes lisibles sur blanc (≥ 4.5:1), par ordre
 * de préférence : la couleur sémantique d'abord, puis des alternatives. Une
 * destination prend la première qui ne se confond ni avec le panier ni avec
 * les destinations déjà colorées (tenant bleu → Catalogue ne reste pas bleu à
 * côté d'un panier bleu).
 */
const CANDIDATES: Record<Exclude<BottomNavDestination, 'cart'>, string[]> = {
  discover: [BOTTOM_NAV_SEMANTIC_COLORS.discover, '#4d7c0f', '#0e7490'],
  catalog: [BOTTOM_NAV_SEMANTIC_COLORS.catalog, '#be185d', '#0e7490', '#4d7c0f'],
  goodies: [BOTTOM_NAV_SEMANTIC_COLORS.goodies, '#a21caf', '#4d7c0f', '#be185d'],
  account: [BOTTOM_NAV_SEMANTIC_COLORS.account, '#475569', '#9f1239', '#0e7490', '#4d7c0f'],
};
/** Écart de teinte minimal (degrés) entre une destination et le panier. */
export const MIN_HUE_DISTANCE = 30;
/** En dessous de cette saturation, une couleur est perçue comme neutre : aucune collision de teinte. */
const NEUTRAL_SATURATION = 0.2;

function hueAndSaturation(hex: string): { hue: number; saturation: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { hue: (hue + 360) % 360, saturation };
}

export function hueDistance(a: string, b: string): number {
  const diff = Math.abs(hueAndSaturation(a).hue - hueAndSaturation(b).hue);
  return Math.min(diff, 360 - diff);
}

/** Deux couleurs se confondent si leurs teintes sont proches (une couleur quasi neutre ne se confond avec rien). */
function collides(a: string, b: string): boolean {
  if (hueAndSaturation(a).saturation < NEUTRAL_SATURATION || hueAndSaturation(b).saturation < NEUTRAL_SATURATION) return false;
  return hueDistance(a, b) < MIN_HUE_DISTANCE;
}

/**
 * Palette complète de la barre pour un tenant : le panier dans la couleur de
 * la boutique (rendue lisible), chaque autre destination dans sa couleur
 * sémantique, ou la première alternative qui reste distincte.
 */
export function resolveBottomNavPalette(tenantPrimary: string | null | undefined): Record<BottomNavDestination, string> {
  const cart = ensureContrastOnWhite(tenantPrimary);
  const taken = [cart];
  const pick = (destination: Exclude<BottomNavDestination, 'cart'>) => {
    const candidates = CANDIDATES[destination];
    const color = candidates.find((candidate) => !taken.includes(candidate) && taken.every((used) => !collides(candidate, used)))
      ?? candidates.find((candidate) => !taken.includes(candidate))
      ?? candidates[0]!;
    taken.push(color);
    return color;
  };
  const discover = pick('discover');
  const catalog = pick('catalog');
  const goodies = pick('goodies');
  const account = pick('account');
  return { discover, catalog, cart, goodies, account };
}

/** Fond de la pastille active : la couleur très diluée dans le blanc. */
export function bottomNavTint(accent: string): string {
  return `color-mix(in srgb, ${accent} ${BOTTOM_NAV_TINT_PERCENT}%, white)`;
}
