import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateIconBuffer } from '@/lib/tenant/generateIconBuffer';

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';

  try {
    const tenant = await getTenant(slug);

    if (!tenant.logo_url) {
      return new NextResponse(null, { status: 404 });
    }

    const logoSize = Math.round(HEIGHT * 0.85);
    const logoBuffer = await generateIconBuffer({ logoUrl: tenant.logo_url, size: logoSize });
    const left = Math.round((WIDTH - logoSize) / 2);
    const top = Math.round((HEIGHT - logoSize) / 2);

    const output = await sharp({
      create: {
        width: WIDTH,
        height: HEIGHT,
        channels: 4,
        background: tenant.primary_color ?? '#1D9E75',
      },
    })
      .composite([{ input: logoBuffer, left, top }])
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(output), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err) {
    console.error('[og-image] Error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
