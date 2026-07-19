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
    // sharp (upload-product-image) a des bindings natifs — l'exclure du
    // bundling webpack évite les erreurs de résolution du binaire sur Vercel.
    serverComponentsExternalPackages: ['sharp'],
  },
};

export default nextConfig;
