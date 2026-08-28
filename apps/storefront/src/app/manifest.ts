import { MetadataRoute } from 'next';
import { getTenant } from '@/lib/tenant/getTenant';

// Explicite depuis que getTenant() n'utilise plus cookies() (Prompt 4) :
// ce fichier perdait son seul déclencheur dynamique implicite. Contenu non
// personnalisé (branding tenant) — bon candidat ISR/statique pour un futur
// prompt ; pas converti ici pour ne pas élargir le périmètre de ce prompt.
export const dynamic = 'force-dynamic';

const FALLBACK_ICONS: MetadataRoute.Manifest['icons'] = [
  { src: '/api/pwa-icon?size=192&purpose=maskable', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
  { src: '/api/pwa-icon?size=512&purpose=maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: '/api/pwa-icon?size=512&purpose=any',      sizes: '512x512', type: 'image/png', purpose: 'any' },
];

// Générique par tenant : mêmes routes/icônes pour toutes les boutiques,
// aucun libellé spécifique à un tenant en particulier.
const SHORTCUTS: MetadataRoute.Manifest['shortcuts'] = [
  {
    name: 'Voir les produits',
    short_name: 'Produits',
    url: '/',
    icons: [{ src: '/api/pwa-icon?size=192', sizes: '192x192', type: 'image/png' }],
  },
  {
    name: 'Mon panier',
    short_name: 'Panier',
    url: '/cart',
    icons: [{ src: '/api/pwa-icon?size=192', sizes: '192x192', type: 'image/png' }],
  },
];

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';

  try {
    const tenant = await getTenant(slug);
    return {
      id:               '/',
      name:             tenant.name,
      short_name:       tenant.name,
      description:      tenant.tagline ?? `${tenant.name} — boutique en ligne`,
      start_url:        '/',
      display:          'standalone',
      display_override: ['standalone', 'browser'],
      background_color: '#ffffff',
      theme_color:      tenant.primary_color ?? '#1D9E75',
      orientation:      'portrait',
      lang:             tenant.locale?.split('-')[0] ?? 'fr',
      categories:       ['food', 'shopping'],
      icons:            FALLBACK_ICONS,
      shortcuts:        SHORTCUTS,
    };
  } catch (err) {
    // Contrairement à une page, un manifeste PWA n'a pas vraiment de notion
    // de "par requête" — un échec de résolution tenant ici (Supabase
    // indisponible pendant le build, p. ex.) ne doit pas faire échouer tout
    // `next build`. Repli sur un manifeste générique, sans branding ; il
    // sera régénéré normalement dès que le tenant redevient joignable.
    console.error('[manifest] getTenant a échoué, repli sur un manifeste générique :', err);
    return {
      id:               '/',
      name:             'Boutique en ligne',
      short_name:       'Boutique',
      description:      'Boutique en ligne',
      start_url:        '/',
      display:          'standalone',
      display_override: ['standalone', 'browser'],
      background_color: '#ffffff',
      theme_color:      '#1D9E75',
      orientation:      'portrait',
      lang:             'fr',
      categories:       ['food', 'shopping'],
      icons:            FALLBACK_ICONS,
      shortcuts:        SHORTCUTS,
    };
  }
}
