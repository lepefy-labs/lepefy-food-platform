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
  // Domaine + DNS déjà rattachés au projet Vercel. La vérification finale
  // sur `events.chloefood.com` se fait après déploiement (aucun accès
  // DNS/Vercel depuis la session de développement) ; le comportement des
  // règles ci-dessous a été vérifié empiriquement sur Next 14.2.3 en local
  // via des requêtes portant l'en-tête `Host` du sous-domaine.
  async rewrites() {
    const eventsSubdomain = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
    if (!eventsSubdomain) return { beforeFiles: [] };

    const onEventsHost = [{ type: 'host', value: eventsSubdomain }];

    // `beforeFiles` (et NON un tableau simple) : un tableau simple est traité
    // par Next.js comme `afterFiles`, donc évalué UNIQUEMENT après avoir
    // constaté qu'aucune page du filesystem ne correspond. Comme `/` existe
    // réellement (app/(shop)/page.tsx — la home boutique), Next servait cette
    // page avant même de regarder l'en-tête `host`, et la règle events
    // n'était jamais atteinte. `beforeFiles` est évalué AVANT le filesystem.
    //
    // Règles ciblées par préfixe plutôt qu'un catch-all `/:path*` : en
    // `beforeFiles`, un catch-all intercepte AUSSI `/_next/static/*`,
    // `/api/*` et `/icons/*` (vérifié empiriquement sur Next 14.2.3 — tous
    // renvoyaient 404 sur le sous-domaine, JS/CSS et checkout compris), et
    // se ré-applique à sa propre sortie (`/` → `/evenementiel` →
    // `/evenementiel/evenementiel` → 404). Ces trois préfixes couvrent 100%
    // de la surface publique du module :
    //   /                     → hub
    //   /evenements/:path*    → détail événement + confirmation
    //   /services/:path*      → détail service + confirmation
    // Toute nouvelle section publique de premier niveau du module doit être
    // ajoutée ici. Les chemins non listés (ex. /products) restent servis par
    // la boutique sur ce sous-domaine — si vous préférez qu'ils renvoient
    // 404, remplacer les deux règles par un catch-all à exclusions
    // explicites : '/:path((?!_next|api|evenementiel|icons|favicon\\.ico|sw\\.js|manifest\\.webmanifest).*)'
    // (testé fonctionnel également, mais la liste d'exclusions doit être
    // maintenue à chaque nouvel asset public ou route racine).
    return {
      beforeFiles: [
        {
          source: '/',
          has: onEventsHost,
          destination: '/evenementiel',
        },
        {
          source: '/evenements/:path*',
          has: onEventsHost,
          destination: '/evenementiel/evenements/:path*',
        },
        {
          source: '/services/:path*',
          has: onEventsHost,
          destination: '/evenementiel/services/:path*',
        },
      ],
    };
  },
};

export default nextConfig;
