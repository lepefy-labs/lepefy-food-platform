import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '480', 10);
  if (Number.isNaN(n)) return 480;
  return Math.min(2000, Math.max(200, n));
}

// Sovrappone il logo del tenant al centro dell'SVG del QR.
// errorCorrectionLevel 'H' tollera fino a ~30% di area coperta:
// usiamo un riquadro bianco arrotondato pari a circa il 22% del lato,
// margine di sicurezza per restare sempre scansionabile.
function overlayLogo(svg: string, size: number, logoUrl: string): string {
  const boxSize = Math.round(size * 0.22);
  const boxPos = Math.round((size - boxSize) / 2);
  const logoSize = Math.round(boxSize * 0.78);
  const logoPos = Math.round((size - logoSize) / 2);

  const overlay = `
    <rect x="${boxPos}" y="${boxPos}" width="${boxSize}" height="${boxSize}" rx="${Math.round(boxSize * 0.18)}" fill="#ffffff" />
    <image href="${logoUrl}" x="${logoPos}" y="${logoPos}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />
  `;

  return svg.replace('</svg>', `${overlay}</svg>`);
}

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') === 'png' ? 'png' : 'svg';
  const size = clampSize(searchParams.get('size'));
  const forceDownload = searchParams.get('download') === '1';

  // Opzionale: forza il colore dei moduli scuri invece del primary_color del tenant.
  // Serve ai template etichetta con look fisso (es. "Etnico") che non possono garantire
  // contrasto sufficiente con qualunque primary_color di tenant venga configurato.
  const darkParam = searchParams.get('dark');
  const darkColor = darkParam && /^[0-9a-fA-F]{6}$/.test(darkParam) ? `#${darkParam}` : tenant.primary_color;

  const origin = req.nextUrl.origin;
  const targetUrl = `${origin}/card`;

  const qrOptions = {
    errorCorrectionLevel: 'H' as const,
    margin: 1,
    width: size,
    color: {
      dark: darkColor,
      light: '#ffffff',
    },
  };

  if (format === 'png') {
    const buffer = await QRCode.toBuffer(targetUrl, { ...qrOptions, type: 'png' });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': forceDownload
          ? `attachment; filename="${tenant.slug}-qr.png"`
          : 'inline',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  let svg = await QRCode.toString(targetUrl, { ...qrOptions, type: 'svg' });

  if (tenant.logo_url) {
    svg = overlayLogo(svg, size, tenant.logo_url);
  }

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Content-Disposition': forceDownload
        ? `attachment; filename="${tenant.slug}-qr.svg"`
        : 'inline',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
