/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@lepefy/types'],
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },
  experimental: {
    typedRoutes: false,
    serverComponentsExternalPackages: ['sharp', '@resvg/resvg-js'],
  },
  async rewrites() {
    const eventsSubdomain = process.env.NEXT_PUBLIC_EVENTS_SUBDOMAIN;
    if (!eventsSubdomain) return { beforeFiles: [] };
    const onEventsHost = [{ type: 'host', value: eventsSubdomain }];
    return {
      beforeFiles: [
        { source: '/admin', has: onEventsHost, destination: '/admin/evenementiel' },
        { source: '/', has: onEventsHost, destination: '/evenementiel' },
        { source: '/evenements/:path*', has: onEventsHost, destination: '/evenementiel/evenements/:path*' },
        { source: '/services/:path*', has: onEventsHost, destination: '/evenementiel/services/:path*' },
      ],
    };
  },
};

export default nextConfig;
