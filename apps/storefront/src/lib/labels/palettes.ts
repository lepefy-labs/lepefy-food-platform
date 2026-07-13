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
