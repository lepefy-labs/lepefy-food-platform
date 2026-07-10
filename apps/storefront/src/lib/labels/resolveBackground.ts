import type { ProductLabelData } from '@lepefy/types';

export const DEFAULT_TEMPLATE_BACKGROUND = '#F3F1EC';

export type ResolvedBackground =
  | { type: 'image'; url: string }
  | { type: 'color'; value: string };

/**
 * Sfondo del pannello hero (sinistra): foto prodotto se presente,
 * altrimenti colore di fallback (prodotto → categoria → default).
 */
export function resolveBackground(product: ProductLabelData): ResolvedBackground {
  const image = product.label_background_image_url ?? product.category?.label_background_image_url ?? null;
  if (image) return { type: 'image', url: image };

  const color =
    product.label_background_color ??
    product.category?.label_background_color ??
    DEFAULT_TEMPLATE_BACKGROUND;

  return { type: 'color', value: color };
}

/**
 * Tinta ambientale per l'intera etichetta (colonna destra + footer legale).
 * Indipendente dal fatto che il pannello hero mostri una foto o un colore:
 * riusa lo stesso campo label_background_color (prodotto → categoria →
 * default) così l'etichetta si legge come un unico pezzo anche quando a
 * sinistra c'è una fotografia, senza ripetere la foto dietro tabella
 * nutrizionale e blocco legale (poco leggibile, sconsigliato) e senza
 * richiedere alcuna nuova colonna o migrazione.
 */
export function resolveAmbientColor(product: ProductLabelData): string {
  return (
    product.label_background_color ??
    product.category?.label_background_color ??
    DEFAULT_TEMPLATE_BACKGROUND
  );
}
