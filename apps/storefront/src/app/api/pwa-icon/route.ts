import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  // size param accepted for manifest compatibility but scaling is left to the OS
  req.nextUrl.searchParams.get('size');

  try {
    const tenant = await getTenant(slug);

    if (!tenant.logo_url) {
      return new NextResponse(null, { status: 404 });
    }

    const response = await fetch(tenant.logo_url);
    if (!response.ok) {
      return new NextResponse(null, { status: 502 });
    }

    const contentType = response.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await response.arrayBuffer());

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err) {
    console.error('[pwa-icon] Error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
