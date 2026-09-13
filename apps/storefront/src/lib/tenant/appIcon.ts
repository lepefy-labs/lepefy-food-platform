export const APP_ICON_DIMENSION = 512;
export const APP_ICON_MAX_BYTES = 1024 * 1024;

interface AppIconMetadata {
  mimeType: string;
  byteLength: number;
  format?: string;
  width?: number;
  height?: number;
  pages?: number;
}

export function validateAppIconMetadata(metadata: AppIconMetadata): string | null {
  if (metadata.mimeType !== 'image/png' || metadata.format !== 'png') {
    return 'Le fichier doit être une image PNG valide.';
  }
  if (metadata.byteLength > APP_ICON_MAX_BYTES) {
    return 'Le fichier ne doit pas dépasser 1 Mo.';
  }
  if (metadata.width !== APP_ICON_DIMENSION || metadata.height !== APP_ICON_DIMENSION || (metadata.pages != null && metadata.pages !== 1)) {
    return 'L’image doit mesurer exactement 512 × 512 px.';
  }
  return null;
}

export function resolveTenantAppIconSource(appIconUrl: string | null | undefined, logoUrl: string | null | undefined): { url: string; dedicated: boolean } | null {
  const dedicatedUrl = appIconUrl?.trim();
  if (dedicatedUrl) return { url: dedicatedUrl, dedicated: true };
  const fallbackUrl = logoUrl?.trim();
  return fallbackUrl ? { url: fallbackUrl, dedicated: false } : null;
}

export function getAppIconRevision(appIconUrl: string | null | undefined): string | null {
  if (!appIconUrl) return null;
  try {
    return new URL(appIconUrl).searchParams.get('v');
  } catch {
    return null;
  }
}

export function buildPwaIconPath(size: number, purpose?: 'any' | 'maskable', revision?: string | null): string {
  const params = new URLSearchParams({ size: String(size) });
  if (purpose) params.set('purpose', purpose);
  if (revision) params.set('revision', revision);
  return `/api/pwa-icon?${params.toString()}`;
}
