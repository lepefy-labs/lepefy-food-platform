// Petites fonctions de couleur pour dériver des variantes visuelles à partir
// des tokens réels du tenant (jamais des hex fixes) et vérifier leur
// contraste avant de choisir une couleur de texte — voir CategoryBlock.tsx.

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function toLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Ratio de contraste WCAG entre deux couleurs hex (1 à 21). */
export function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (lighter + 0.05) / (darker + 0.05);
}

/** Approxime `color-mix(in srgb, hex X%, black)` (mélange gamma-encodé simple, cohérent avec globals.css). */
export function mixWithBlack(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  const factor = percent / 100;
  const toHex = (c: number) => Math.round(c * factor).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
