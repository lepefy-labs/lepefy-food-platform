/**
 * Couleurs de plateforme de /card (comme methodColor pour les marques de
 * paiement) : l'action « payer » garde partout le même bleu, distinct de la
 * couleur du tenant qui reste celle de l'identité et des contacts. Blanc sur
 * ce bleu : contraste 6,7:1 (WCAG AA).
 */
export const CARD_PAY_COLOR = '#1D4ED8';

/** Fond chaud neutre de la page, sous les surfaces blanches. */
export const CARD_PAGE_BACKGROUND = '#F7F6F2';

/** Texte lisible (#111827 ou blanc) sur une couleur tenant hex. */
export function readableForeground(hex: string): '#111827' | '#ffffff' {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '#111827';
  const channel = (offset: number) => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) > 0.42 ? '#111827' : '#ffffff';
}

/** Couleur tenant assombrie (mélange avec du noir) : fond de la hero, toujours sombre sous un texte blanc. */
export function darkenHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '#111827';
  const keep = 1 - Math.min(1, Math.max(0, amount));
  const channel = (offset: number) => Math.round(parseInt(normalized.slice(offset, offset + 2), 16) * keep).toString(16).padStart(2, '0');
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

/** Couleur tenant éclaircie (mélange avec du blanc) : surfaces claires teintées, texte foncé lisible. */
export function lightenHex(hex: string, amount: number): string {
  const normalized = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return '#F3F4F6';
  const mix = Math.min(1, Math.max(0, amount));
  const channel = (offset: number) => {
    const value = parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.round(value + (255 - value) * mix).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}
