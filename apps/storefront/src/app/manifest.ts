import { MetadataRoute } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';
import { buildPwaIconPath, getAppIconRevision } from '@/lib/tenant/appIcon';

export const dynamic = 'force-dynamic';

function buildIcons(revision?: string | null): MetadataRoute.Manifest['icons'] {
  return [
    { src: buildPwaIconPath(192, 'maskable', revision), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: buildPwaIconPath(512, 'maskable', revision), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: buildPwaIconPath(512, 'any', revision), sizes: '512x512', type: 'image/png', purpose: 'any' },
  ];
}

function buildShortcuts(revision?: string | null): MetadataRoute.Manifest['shortcuts'] {
  const icon = { src: buildPwaIconPath(192, undefined, revision), sizes: '192x192', type: 'image/png' };
  return [
    { name: 'Voir les produits', short_name: 'Produits', url: '/', icons: [icon] },
    { name: 'Mon panier', short_name: 'Panier', url: '/cart', icons: [icon] },
  ];
}

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  try {
    const tenant = await getTenant(slug);
    const revision = getAppIconRevision(tenant.app_icon_url);
    return {
      id: '/', name: tenant.name, short_name: tenant.name,
      description: tenant.tagline ?? `${tenant.name} — boutique en ligne`,
      start_url: '/', display: 'standalone', display_override: ['standalone', 'browser'],
      background_color: '#ffffff', theme_color: tenant.primary_color ?? '#1D9E75',
      orientation: 'portrait', lang: tenant.locale?.split('-')[0] ?? 'fr',
      categories: ['food', 'shopping'], icons: buildIcons(revision), shortcuts: buildShortcuts(revision),
    };
  } catch (err) {
    console.error('[manifest] getTenant a échoué, repli sur un manifeste générique :', err);
    return {
      id: '/', name: 'Boutique en ligne', short_name: 'Boutique', description: 'Boutique en ligne',
      start_url: '/', display: 'standalone', display_override: ['standalone', 'browser'],
      background_color: '#ffffff', theme_color: '#1D9E75', orientation: 'portrait', lang: 'fr',
      categories: ['food', 'shopping'], icons: buildIcons(), shortcuts: buildShortcuts(),
    };
  }
}
