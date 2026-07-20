import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTenant } from '@/lib/tenant/getTenant';

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '512', 10);
  if (Number.isNaN(n)) return 512;
  return Math.min(1024, Math.max(48, n));
}

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const size = clampSize(req.nextUrl.searchParams.get('size'));

  try {
    const tenant = await getTenant(slug);

    if (!tenant.logo_url) {
      return new NextResponse(null, { status: 404 });
    }

    const response = await fetch(tenant.logo_url);
    if (!response.ok) {
      return new NextResponse(null, { status: 502 });
    }

    const sourceBuffer = Buffer.from(await response.arrayBuffer());

    // Le manifeste déclare des `sizes` exactes (192x192, 512x512) pour cette
    // même route : servir l'asset source tel quel, sans le redimensionner à
    // ce que `size` demande, produit un mismatch déclaré/réel que Chrome
    // peut rejeter silencieusement au moment de générer le WebAPK Android.
    const resized = await sharp(sourceBuffer)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(resized), {
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
