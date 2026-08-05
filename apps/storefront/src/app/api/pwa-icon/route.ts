import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateIconBuffer } from '@/lib/tenant/generateIconBuffer';

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

    if (!tenant.logo_url) {
      return new NextResponse(null, { status: 404 });
    }

    let output: Buffer;

    if (purpose === 'maskable') {
      // Safe-zone ~62% (même proportion que card/pwa-icon), logo centré sur
      // un fond plein à la couleur du tenant — une icône maskable transparente
      // hors safe-zone rend mal sur les launchers qui masquent sans gérer l'alpha.
      const logoSize = Math.round(size * 0.62);
      const logoBuffer = await generateIconBuffer({ logoUrl: tenant.logo_url, size: logoSize });
      const logoOffset = Math.round((size - logoSize) / 2);

      output = await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: tenant.primary_color ?? '#1D9E75',
        },
      })
        .composite([{ input: logoBuffer, left: logoOffset, top: logoOffset }])
        .png()
        .toBuffer();
    } else {
      // Le manifeste déclare des `sizes` exactes (192x192, 512x512) pour cette
      // même route : servir l'asset source tel quel, sans le redimensionner à
      // ce que `size` demande, produit un mismatch déclaré/réel que Chrome
      // peut rejeter silencieusement au moment de générer le WebAPK Android.
      output = await generateIconBuffer({ logoUrl: tenant.logo_url, size });
    }

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
