import { NextRequest, NextResponse } from 'next/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateTenantAppIconBuffer } from '@/lib/tenant/generateIconBuffer';
import { resolveTenantAppIconSource } from '@/lib/tenant/appIcon';

const STANDARD_ARTWORK_SCALE = 0.82;
const MASKABLE_ARTWORK_SCALE = 0.62;

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '512', 10);
  if (Number.isNaN(n)) return 512;
  return Math.min(1024, Math.max(48, n));
}

function parsePurpose(raw: string | null): 'any' | 'maskable' {
  return raw === 'maskable' ? 'maskable' : 'any';
}

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const size = clampSize(req.nextUrl.searchParams.get('size'));
  const purpose = parsePurpose(req.nextUrl.searchParams.get('purpose'));

  try {
    const tenant = await getTenant(slug);
    const source = resolveTenantAppIconSource(tenant.app_icon_url, tenant.logo_url);
    if (!source) return new NextResponse(null, { status: 404 });

    const output = await generateTenantAppIconBuffer({
      imageUrl: source.url,
      size,
      backgroundColor: tenant.primary_color ?? '#1D9E75',
      artworkScale: purpose === 'maskable' ? MASKABLE_ARTWORK_SCALE : STANDARD_ARTWORK_SCALE,
    });

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err) {
    console.error('[pwa-icon] Error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
