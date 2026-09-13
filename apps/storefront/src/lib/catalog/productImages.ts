import type { ProductImage } from '@lepefy/types';

export const MAX_PRODUCT_IMAGES = 8;

export function normalizeProductImages(
  raw: unknown,
  primaryUrl?: string | null,
  fallbackAlt?: string,
): ProductImage[] {
  const candidates: unknown[] = [];
  if (primaryUrl) candidates.push({ url: primaryUrl, alt: fallbackAlt });
  if (Array.isArray(raw)) candidates.push(...raw);

  const seen = new Set<string>();
  const images: ProductImage[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const value = candidate as Record<string, unknown>;
    if (typeof value.url !== 'string') continue;
    const url = value.url.trim();
    if (!url || seen.has(url)) continue;

    const alt = typeof value.alt === 'string' ? value.alt.trim().slice(0, 180) : '';
    images.push(alt ? { url, alt } : { url });
    seen.add(url);
    if (images.length === MAX_PRODUCT_IMAGES) break;
  }

  return images;
}

export function moveProductImage(
  images: ProductImage[],
  fromIndex: number,
  toIndex: number,
): ProductImage[] {
  if (
    fromIndex < 0 ||
    fromIndex >= images.length ||
    toIndex < 0 ||
    toIndex >= images.length ||
    fromIndex === toIndex
  ) {
    return images;
  }

  const next = [...images];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}
