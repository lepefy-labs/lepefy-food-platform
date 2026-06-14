import { MetadataRoute } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return {
    name:             tenant.name,
    short_name:       tenant.name,
    description:      tenant.tagline ?? `${tenant.name} — boutique en ligne`,
    start_url:        '/',
    display:          'standalone',
    background_color: '#ffffff',
    theme_color:      tenant.primary_color ?? '#1D9E75',
    orientation:      'portrait',
    lang:             tenant.locale?.split('-')[0] ?? 'fr',
    icons: [
      {
        src:     '/api/pwa-icon?size=192',
        sizes:   '192x192',
        type:    'image/png',
        purpose: 'maskable',
      },
      {
        src:     '/api/pwa-icon?size=512',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'maskable',
      },
      {
        src:     '/api/pwa-icon?size=512',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'any',
      },
    ],
  };
}
