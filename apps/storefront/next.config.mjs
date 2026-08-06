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
};

export default nextConfig;
