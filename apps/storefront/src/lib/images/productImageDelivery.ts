export const PRODUCT_IMAGE_VARIANTS = {
  thumbnail: 160,
  catalog: 480,
  detail: 960,
  full: 1600,
} as const;

export type ProductImageVariant = keyof typeof PRODUCT_IMAGE_VARIANTS;

export interface ManagedProductImage {
  masterUrl: string;
  masterMime: 'image/jpeg' | 'image/png' | 'image/webp';
  variants: Record<ProductImageVariant, string>;
  variantMime: 'image/webp';
  maxDimensions: typeof PRODUCT_IMAGE_VARIANTS;
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

/** Only our immutable v2 path proves that all four variants were uploaded. */
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
    const match = /^\/storage\/v1\/object\/public\/assets\/tenants\/([0-9a-f-]{36})\/products\/([0-9a-f-]{36})\/([0-9a-f-]{32,36})\/master\.(jpg|jpeg|png|webp)$/i.exec(url.pathname);
    if (!match || (expectedTenantId && match[1]?.toLowerCase() !== expectedTenantId.toLowerCase())) return null;
    if (url.search || url.hash) return null;
    const prefix = value.slice(0, value.lastIndexOf('/') + 1);
    return {
      masterUrl: value,
      masterMime: match[4] === 'png' ? 'image/png' : match[4] === 'webp' ? 'image/webp' : 'image/jpeg',
      tenantId: match[1]!,
      productId: match[2]!,
      imageId: match[3]!,
      version: match[3]!,
      status: 'ready',
      variantMime: 'image/webp',
      maxDimensions: PRODUCT_IMAGE_VARIANTS,
      variants: {
        thumbnail: prefix + 'thumbnail.webp',
        catalog: prefix + 'catalog.webp',
        detail: prefix + 'detail.webp',
        full: prefix + 'full.webp',
      },
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
    ? { src: managed.variants[variant], masterUrl: managed.masterUrl, variants: managed.variants, direct: true as const }
    : { src: value ?? '', masterUrl: value ?? '', variants: null, direct: false as const };
}
