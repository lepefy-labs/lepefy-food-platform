import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { Resvg } from '@resvg/resvg-js';
import { getTenant } from '@/lib/tenant/getTenant';

export const runtime = 'nodejs'; // requis par @resvg/resvg-js (bindings natifs), même pattern que api/shop/qr-code
export const dynamic = 'force-dynamic';

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '480', 10);
  if (Number.isNaN(n)) return 480;
  return Math.min(2000, Math.max(200, n));
}

// Télécharge le logo du tenant et le convertit en data URI — un <image href>
// pointant vers une URL distante ne se charge PAS pendant la rasterisation
// resvg (aucun accès réseau), et casserait silencieusement le format PNG.
// Nécessaire aussi pour le SVG servi tel quel : le client qui scanne/imprime
// ne doit pas dépendre de la disponibilité du storage à cet instant précis.
async function fetchLogoDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/png';
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    console.error('[card/qr-code] failed to fetch tenant logo:', err);
    return null;
  }
}

// Sovrappone il logo del tenant al centro dell'SVG del QR.
// errorCorrectionLevel 'H' tollera fino a ~30% di area coperta:
// usiamo un riquadro bianco arrotondato pari a circa il 22% del lato,
// margine di sicurezza per restare sempre scansionabile.
//
// Bug corretto ici : les coordonnées étaient calculées en pixels (ex. 480)
// puis injectées telles quelles dans un SVG dont le système de coordonnées
// réel est le viewBox généré par `qrcode` en unités-module (ex. "0 0 31
// 31") — le logo atterrissait hors du viewBox visible, invisible à
// l'exécution. On lit le viewBox réel et on met à l'échelle en conséquence.
function overlayLogo(svg: string, size: number, logoDataUri: string): string {
  const viewBoxMatch = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const viewBoxSize = viewBoxMatch?.[1] ? parseFloat(viewBoxMatch[1]) : size;
  const scale = viewBoxSize / size;

  const boxSizePx = size * 0.22;
  const boxPosPx = (size - boxSizePx) / 2;
  const logoSizePx = boxSizePx * 0.78;
  const logoPosPx = (size - logoSizePx) / 2;

  const boxSize = boxSizePx * scale;
  const boxPos = boxPosPx * scale;
  const logoSize = logoSizePx * scale;
  const logoPos = logoPosPx * scale;

  const overlay = `
    <rect x="${boxPos}" y="${boxPos}" width="${boxSize}" height="${boxSize}" rx="${boxSize * 0.18}" fill="#ffffff" />
    <image href="${logoDataUri}" x="${logoPos}" y="${logoPos}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />
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

  // Dominio canonico : storefront_url du tenant (override per-tenant, même
  // pattern que EventsHeader/EventsFooter/loyalty wallet) > NEXT_PUBLIC_APP_URL
  // > host ayant servi la requête en dernier recours. Jamais nextUrl.origin
  // en premier (même bug que l'ancien api/shop/qr-code/route.tsx) — sinon le
  // QR encode l'URL Vercel brute si la génération transite par ce host
  // plutôt que le domaine custom.
  const origin = tenant.storefront_url || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const targetUrl = `${origin.replace(/\/+$/, '')}/card`;

  const qrOptions = {
    errorCorrectionLevel: 'H' as const,
    margin: 1,
    width: size,
    color: {
      dark: darkColor,
      light: '#ffffff',
    },
  };

  let svg = await QRCode.toString(targetUrl, { ...qrOptions, type: 'svg' });

  if (tenant.logo_url) {
    const logoDataUri = await fetchLogoDataUri(tenant.logo_url);
    if (logoDataUri) svg = overlayLogo(svg, size, logoDataUri);
  }

  if (format === 'png') {
    // Rasterise le même SVG (avec overlay déjà intégré) plutôt que de
    // regénérer un PNG "nu" via QRCode.toBuffer — sinon le format PNG
    // (celui utilisé par l'affiche imprimable, voir api/admin/card/poster)
    // n'affichait jamais le logo.
    const resvg = new Resvg(svg, { fitTo: { mode: 'original' } });
    const buffer = resvg.render().asPng();

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
