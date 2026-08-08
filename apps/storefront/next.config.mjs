/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@lepefy/types'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7, // 7 giorni
  },
  experimental: {
    typedRoutes: false,
    // sharp (upload-product-image) et @resvg/resvg-js (api/shop/qr-code) ont
    // des bindings natifs — les exclure du bundling webpack évite les
    // erreurs de résolution du binaire sur Vercel.
    serverComponentsExternalPackages: ['sharp', '@resvg/resvg-js'],
  },
  // Module Événementiel (052) — sous-domaine dédié optionnel par tenant
  // (ex. events.chloefood.com), configurable via NEXT_PUBLIC_EVENTS_SUBDOMAIN.
  // Rewrite au niveau next.config.mjs (PAS middleware.ts, qui reste
  // volontairement vide — Root Directory Vercel = apps/storefront empêche
  // l'Edge Middleware sur ce projet, cf. CLAUDE.md). Absent/vide pour un
  // tenant qui n'active pas cette option : aucun rewrite n'est alors généré.
  //
  // ⚠️ Non testé en conditions réelles dans ce cycle (pas d'accès DNS/Vercel
  // depuis cette session) — le domaine `events.chloefood.com` doit encore
  // être ajouté manuellement au projet Vercel + CNAME DNS par Robertin avant
  // de pouvoir vérifier ce comportement en production (voir rapport d'écarts).
  async rewrites() {
    const eventsSubdomain = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
    if (!eventsSubdomain) return [];

    return [
      {
        source: '/',
        has: [{ type: 'host', value: eventsSubdomain }],
        destination: '/evenementiel',
      },
      {
        source: '/:path*',
        has: [{ type: 'host', value: eventsSubdomain }],
        destination: '/evenementiel/:path*',
      },
    ];
  },
};

export default nextConfig;
