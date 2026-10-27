import type { MetadataRoute } from 'next';

/** Lepefy brand colour (platform default); the manifest never takes the tenant's identity. */
export const ADMIN_PWA_THEME_COLOR = '#6D5AF6';
export const ADMIN_PWA_BACKGROUND_COLOR = '#F7F8FA';
export const ADMIN_PWA_NAME = 'Lepefy Admin';
export const ADMIN_MANIFEST_PATH = '/admin/manifest.webmanifest';

/**
 * Manifest of the installable admin app. Separate `id` from the storefront PWA
 * (`/`), scope limited to the admin so an installed Lepefy Admin never captures
 * storefront links. The scope has no trailing slash on purpose: the start URL
 * `/admin` must be inside it.
 */
export function buildAdminManifest(): MetadataRoute.Manifest {
  return {
    id: '/admin',
    name: ADMIN_PWA_NAME,
    short_name: ADMIN_PWA_NAME,
    description: 'Administration de votre boutique et de votre espace événementiel.',
    start_url: '/admin?source=pwa',
    scope: '/admin',
    display: 'standalone',
    display_override: ['standalone', 'browser'],
    background_color: ADMIN_PWA_BACKGROUND_COLOR,
    theme_color: ADMIN_PWA_THEME_COLOR,
    lang: 'fr',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/brand/admin-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/admin-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/admin-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
