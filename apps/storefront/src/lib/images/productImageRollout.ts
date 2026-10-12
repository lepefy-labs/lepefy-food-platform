import 'server-only';

/** Server-side allow-list. Empty/missing means legacy delivery for every tenant. */
export function productImageDeliveryEnabled(tenant: { id: string; slug: string }): boolean {
  const configured = process.env.PRODUCT_IMAGE_VARIANTS_TENANTS;
  if (!configured) return false;
  const allowed = configured.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(tenant.id.toLowerCase()) || allowed.includes(tenant.slug.toLowerCase());
}
