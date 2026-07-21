import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { getTenant } from '@/lib/tenant/getTenant';
import { generateIconBuffer } from '@/lib/tenant/generateIconBuffer';

export const dynamic = 'force-dynamic';

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '512', 10);
  if (Number.isNaN(n)) return 512;
  return Math.min(1024, Math.max(48, n));
}

// Trattamento fisso di piattaforma — NON tenant-specific.
const CARD_ICON_BACKGROUND = '#111827'; // slate scuro, distinto da qualunque brand tenant
const BADGE_COLOR = '#14B8A6'; // accent fisso per il badge, distinto dallo sfondo

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const size = clampSize(req.nextUrl.searchParams.get('size'));

  try {
    const tenant = await getTenant(slug);

    if (!tenant.logo_url) {
      return new NextResponse(null, { status: 404 });
    }

    // Logo tenant ridimensionato più piccolo del canvas (safe zone ~70%,
    // pattern standard maskable icon) per lasciare spazio allo sfondo scuro
    // visibile tutt'intorno — è proprio lo sfondo a fare la differenza visiva.
    const logoSize = Math.round(size * 0.62);
    const logoBuffer = await generateIconBuffer({ logoUrl: tenant.logo_url, size: logoSize });
    const logoOffset = Math.round((size - logoSize) / 2);

    // Badge: piccolo cerchio pieno in basso a destra, nessun glifo interno
    // necessario — a dimensioni icona reali (anche 48-192px su schermo) un
    // secondo punto colore è più leggibile di un'icona minuscola dentro
    // un'icona già minuscola.
    const badgeRadius = Math.round(size * 0.13);
    const badgeCx = Math.round(size * 0.80);
    const badgeCy = Math.round(size * 0.80);
    const badgeSvg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${badgeCx}" cy="${badgeCy}" r="${badgeRadius}" fill="${BADGE_COLOR}" stroke="#ffffff" stroke-width="${Math.max(2, Math.round(size * 0.012))}"/>
    </svg>`;
    const badgeBuffer = Buffer.from(badgeSvg);

    const composed = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: CARD_ICON_BACKGROUND,
      },
    })
      .composite([
        { input: logoBuffer, left: logoOffset, top: logoOffset },
        { input: badgeBuffer, left: 0, top: 0 },
      ])
      .png()
      .toBuffer();

    return new NextResponse(new Uint8Array(composed), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    console.error('[card/pwa-icon] Error:', err);
    return new NextResponse(null, { status: 500 });
  }
}
