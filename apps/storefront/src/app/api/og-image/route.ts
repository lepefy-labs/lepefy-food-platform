import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateIconBuffer } from '@/lib/tenant/generateIconBuffer';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';

  try {
    const tenant = await getTenant(slug);

    if (!tenant.logo_url) {
      return new NextResponse(null, { status: 404 });
    }

    const primary = tenant.primary_color ?? '#1D9E75';
    const secondary = tenant.secondary_color ?? primary;

    // Fond en dégradé diagonal primary -> secondary (au lieu d'un aplat) —
    // toujours dérivé du tenant, jamais de couleur fixe.
    const gradientSvg = `
      <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="${primary}" />
            <stop offset="100%" stop-color="${secondary}" />
          </linearGradient>
        </defs>
        <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)" />
      </svg>
    `;

    const logoSize = Math.round(HEIGHT * 0.95);
    const logoBuffer = await generateIconBuffer({ logoUrl: tenant.logo_url, size: logoSize });
    const left = Math.round((WIDTH - logoSize) / 2);
    const top = Math.round((HEIGHT - logoSize) / 2);

    const output = await sharp(Buffer.from(gradientSvg))
      .composite([{ input: logoBuffer, left, top }])
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        // Le CDN Vercel garde la réponse en cache (utile pour les scrapers
        // sociaux), mais le navigateur ne met JAMAIS en cache : sinon on
        // revoit une ancienne version pendant les tests, même après un vrai
        // changement de code — cause probable du "0.85 -> 0.95 rien ne change".
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'CDN-Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err) {
    console.error('[og-image] Error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
