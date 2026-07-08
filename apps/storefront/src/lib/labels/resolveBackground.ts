import type { ProductLabelData } from '@lepefy/types';

export const DEFAULT_TEMPLATE_BACKGROUND = '#F3F1EC';

export type ResolvedBackground =
  | { type: 'image'; url: string }
  | { type: 'color'; value: string };

export function resolveBackground(product: ProductLabelData): ResolvedBackground {
  const image = product.label_background_image_url ?? product.category?.label_background_image_url ?? null;
  if (image) return { type: 'image', url: image };

  const color =
    product.label_background_color ??
    product.category?.label_background_color ??
    DEFAULT_TEMPLATE_BACKGROUND;

  return { type: 'color', value: color };
}
