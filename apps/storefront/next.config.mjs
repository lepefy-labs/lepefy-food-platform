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
  },
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;
