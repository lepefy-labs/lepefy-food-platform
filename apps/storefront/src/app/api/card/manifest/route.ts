import { NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  return NextResponse.json({
    id: '/card',
    name: `${tenant.name} — Carte de contact`,
    short_name: `Carte ${tenant.name}`,
    start_url: '/card',
    scope: '/card',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: tenant.primary_color,
    icons: [
      { src: '/api/card/pwa-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/api/card/pwa-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, {
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'no-store',
    },
  });
}
