/** Fallback width of each named use; both set layouts contain these four widths. */
export const PRODUCT_IMAGE_VARIANTS = {
  thumbnail: 160,
  catalog: 480,
  detail: 960,
  full: 1600,
} as const;

export type ProductImageVariant = keyof typeof PRODUCT_IMAGE_VARIANTS;

/** v3 ladder: 320 and 640 cover cards at DPR 1–3 without jumping to 480/960. */
export const PRODUCT_IMAGE_WIDTHS_V3 = [160, 320, 480, 640, 960, 1600] as const;
export const PRODUCT_IMAGE_WEBP_QUALITY_V3 = 75;

const V2_FILES: Record<number, string> = { 160: 'thumbnail.webp', 480: 'catalog.webp', 960: 'detail.webp', 1600: 'full.webp' };

export interface ManagedProductImage {
  masterUrl: string;
  masterMime: 'image/jpeg' | 'image/png' | 'image/webp';
  /** 2: {imageId}/master + thumbnail/catalog/detail/full; 3: {imageId}/v3/master + w{width}.webp. */
  layout: 2 | 3;
  variants: Record<ProductImageVariant, string>;
  srcSet: Array<{ url: string; width: number }>;
  variantMime: 'image/webp';
  tenantId: string;
  productId: string;
  imageId: string;
  version: string;
  status: 'ready';
}

export function isExternalHttpImage(value: string, supabaseUrl: string | null | undefined): boolean {
  try {
    const url = new URL(value);
    const base = supabaseUrl ? new URL(supabaseUrl) : null;
    return (url.protocol === 'https:' || url.protocol === 'http:') && (!base || url.origin !== base.origin);
  } catch {
    return false;
  }
}

/** Only our immutable v2/v3 paths prove that every variant of the set was uploaded. */
export function parseManagedProductImage(
  value: string | null | undefined,
  supabaseUrl: string | null | undefined,
  expectedTenantId?: string,
): ManagedProductImage | null {
  if (!value || !supabaseUrl) return null;
  try {
    const url = new URL(value);
    const base = new URL(supabaseUrl);
    if (url.origin !== base.origin || url.username || url.password) return null;
    const match = /^\/storage\/v1\/object\/public\/assets\/tenants\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/([0-9a-f-]{32,36})\/(v3\/)?master\.(jpg|jpeg|png|webp)$/i.exec(url.pathname);
    if (!match || (expectedTenantId && match[1]?.toLowerCase() !== expectedTenantId.toLowerCase())) return null;
    if (url.search || url.hash) return null;
    const layout = match[4] ? 3 : 2;
    const prefix = value.slice(0, value.lastIndexOf('/') + 1);
    const file = (width: number) => prefix + (layout === 3 ? `w${width}.webp` : V2_FILES[width]);
    const widths: readonly number[] = layout === 3 ? PRODUCT_IMAGE_WIDTHS_V3 : Object.values(PRODUCT_IMAGE_VARIANTS);
    const ext = match[5]!.toLowerCase();
    return {
      masterUrl: value,
      masterMime: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg',
      layout,
      tenantId: match[1]!,
      productId: match[2]!,
      imageId: match[3]!,
      version: layout === 3 ? match[3]! + '/v3' : match[3]!,
      status: 'ready',
      variantMime: 'image/webp',
      variants: {
        thumbnail: file(PRODUCT_IMAGE_VARIANTS.thumbnail),
        catalog: file(PRODUCT_IMAGE_VARIANTS.catalog),
        detail: file(PRODUCT_IMAGE_VARIANTS.detail),
        full: file(PRODUCT_IMAGE_VARIANTS.full),
      },
      srcSet: widths.map((width) => ({ url: file(width), width })),
    };
  } catch {
    return null;
  }
}

export function resolveProductImage(
  value: string | null | undefined,
  variant: ProductImageVariant,
  enabled: boolean,
  supabaseUrl: string | null | undefined,
  tenantId?: string,
) {
  const managed = enabled && tenantId ? parseManagedProductImage(value, supabaseUrl, tenantId) : null;
  return managed
    ? {
        src: managed.variants[variant],
        masterUrl: managed.masterUrl,
        srcSet: managed.srcSet.map((entry) => `${entry.url} ${entry.width}w`).join(', '),
        direct: true as const,
      }
    : { src: value ?? '', masterUrl: value ?? '', srcSet: null, direct: false as const };
}
