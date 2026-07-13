import type { LabelPaletteKey } from '@lepefy/types';

export interface LabelPalette {
  label: string;
  description: string;
  primary: string;
  secondary: string;
  accent: string;
  ambient: string;
}

export const LABEL_PALETTES: Record<LabelPaletteKey, LabelPalette> = {
  verde_palma: {
    label: 'Verde Palma & Oro',
    description: 'Verde naturale più saturo di oggi, righe e zebrature in oro, sfondo avorio caldo.',
    primary: '#1B8A44',
    secondary: '#E8A93C',
    accent: '#0F3D2E',
    ambient: '#FBF6E9',
  },
  blu_epices: {
    label: 'Blu Épices & Oro',
    description: 'Blu cobalto del sacchetto épices, oro come accento qualità, verde foglia con parsimonia.',
    primary: '#0F3D7A',
    secondary: '#E8A93C',
    accent: '#2F8F52',
    ambient: '#F4F0E4',
  },
  terra_piccante: {
    label: 'Terra Piccante',
    description: 'Terracotta della polvere di spezie, verde in secondo piano, sfondo sabbia.',
    primary: '#C1440E',
    secondary: '#E8A93C',
    accent: '#1F5E3E',
    ambient: '#FBF3EA',
  },
};

export const DEFAULT_LABEL_PALETTE: LabelPaletteKey = 'blu_epices';

/** Colore fisso del badge "100% Naturale" — indipendente dalla palette scelta, come un bollino di certificazione. */
export const NATURAL_BADGE_COLOR = '#1B8A44';

/**
 * Sfondo "verde-bianco dinamico" per la colonna dati (template default) — due aloni verdi morbidi
 * negli angoli sopra il colore ambientale risolto (prodotto → categoria → palette). Nessun pattern
 * ripetuto: il centro, dove sta il testo, resta leggibile.
 */
export function ambientWashBackground(ambientColor: string): string {
  return `radial-gradient(60% 55% at 100% 0%, ${NATURAL_BADGE_COLOR}29, transparent 70%), radial-gradient(55% 50% at 0% 100%, ${NATURAL_BADGE_COLOR}1f, transparent 70%), ${ambientColor}`;
}

/** Stessa idea, versione più discreta per la fascia footer legale (bassa e larga). */
export function footerWashBackground(ambientColor: string): string {
  return `radial-gradient(120% 220% at 0% 0%, ${NATURAL_BADGE_COLOR}1a, transparent 75%), ${ambientColor}`;
}

/** Fascia decorativa a triangoli (richiamo kente) usata come divisore tra il corpo dell'etichetta e il footer legale. */
export function kenteStripBackground(colors: LabelPalette): string {
  return `repeating-linear-gradient(115deg, ${colors.secondary} 0 1.4mm, transparent 1.4mm 2.8mm), repeating-linear-gradient(65deg, ${colors.accent} 0 1.4mm, transparent 1.4mm 2.8mm), ${colors.primary}`;
}
