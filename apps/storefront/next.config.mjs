import { adminHostRedirects } from './adminHostRedirects.mjs';
import { storefrontRewrites } from './storefrontRewrites.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@lepefy/types'],
  // Build identity for the PWA update check (docs/PWA_LIFECYCLE.md); empty
  // outside Vercel, which keeps the check inert in local development.
  env: { NEXT_PUBLIC_APP_VERSION: process.env.VERCEL_GIT_COMMIT_SHA ?? '' },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co', pathname: '/storage/v1/object/public/**' }],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },
  experimental: {
    typedRoutes: false,
    serverComponentsExternalPackages: ['sharp', '@resvg/resvg-js'],
  },
  async redirects() {
    return [
      {
        source: '/products',
        destination: '/',
        permanent: true,
      },
      // Unified Lepefy Admin origin: empty until ADMIN_HOST is configured.
      ...adminHostRedirects(process.env),
    ];
  },
  async rewrites() {
    return storefrontRewrites(process.env);
  },
};

export default nextConfig;
