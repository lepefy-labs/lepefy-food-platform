import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTicketUrl } from '@/lib/events/ticketUrl';

// QR d'entrée — encode l'URL publique du billet
// (/evenementiel/billet/[qr_token], cf. lib/events/ticketUrl.ts) et non plus
// le token nu : scanné avec n'importe quelle app caméra, il ouvre la page de
// récapitulatif du billet. Le scanner admin extrait le token de l'URL décodée
// (extractQrToken, tolérant aux deux formats). Error correction 'H'
// (obligatoire : le logo tenant recouvre le centre du QR, 'H' tolère ~30%
// de modules masqués).
export const dynamic = 'force-dynamic';

// Overlay logo au centre du QR. Contrairement à overlayLogo() de
// api/shop/qr-code (bug connu : coordonnées en pixels injectées dans un
// viewBox en unités-module → logo hors canvas), les coordonnées sont ici
// calculées dans les unités du viewBox réellement produit par QRCode.toString
// (modules + marge), parsées depuis le SVG généré.
//
// Le logo est incorporé en data URI (fetch serveur) et JAMAIS référencé par
// URL externe : ce SVG est affiché via <img src="/api/events/...">, et un SVG
// chargé comme image est rendu en "secure static mode" par les navigateurs —
// toute ressource externe (<image href="https://...">) serait silencieusement
// ignorée.
function overlayCenterBadge(svg: string, badgeSvg: (box: BadgeBox) => string): string {
  const vb = svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
  if (!vb?.[1]) return svg;

  const size = parseFloat(vb[1]);
  // Zone centrale ≈ 26% de la largeur (fond blanc), logo ≈ 20% — surface
  // masquée ~6.8% du QR, très en dessous de la tolérance de 'H' (~30%).
  const boxSize = size * 0.26;
  const boxPos = (size - boxSize) / 2;
  const inner = size * 0.2;
  const innerPos = (size - inner) / 2;

  const overlay = badgeSvg({ boxSize, boxPos, inner, innerPos, size });
  return svg.replace('</svg>', `${overlay}</svg>`);
}

interface BadgeBox {
  boxSize: number;
  boxPos: number;
  inner: number;
  innerPos: number;
  size: number;
}

// Petit bordo/fond blanc autour du logo : garantit le contraste avec les
// modules QR adjacents quelle que soit la couleur/transparence du logo.
function whiteBox({ boxSize, boxPos }: BadgeBox): string {
  return `<rect x="${boxPos}" y="${boxPos}" width="${boxSize}" height="${boxSize}" rx="${boxSize * 0.18}" fill="#ffffff"/>`;
}

function logoBadge(dataUri: string): (box: BadgeBox) => string {
  return (box) =>
    `${whiteBox(box)}<image href="${dataUri}" x="${box.innerPos}" y="${box.innerPos}" width="${box.inner}" height="${box.inner}" preserveAspectRatio="xMidYMid meet"/>`;
}

// Fallback initiales : cercle couleur primaire du tenant + 1-2 lettres
// blanches. font-family générique (sans-serif) volontaire : ce SVG est rendu
// par le NAVIGATEUR du client (pas rasterizé côté serveur), les fonts système
// du client sont donc disponibles — pas de problème "tofu" serverless ici.
function initialsBadge(name: string, primaryColor: string): (box: BadgeBox) => string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

  return (box) => {
    const c = box.size / 2;
    const r = box.inner / 2;
    const fontSize = box.inner * (initials.length > 1 ? 0.52 : 0.62);
    return `${whiteBox(box)}<circle cx="${c}" cy="${c}" r="${r}" fill="${primaryColor}"/><text x="${c}" y="${c}" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${fontSize}" fill="#ffffff">${initials}</text>`;
  };
}

// Fetch du logo tenant → data URI. Best-effort : tout échec (URL morte,
// timeout, type inattendu) déclenche le fallback initiales, jamais une
// erreur — le QR reste toujours servi.
async function fetchLogoDataUri(logoUrl: string): Promise<string | null> {
  try {
    const res = await fetch(logoUrl, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? 'image/png';
    if (!contentType.startsWith('image/')) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'token requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data: reservation } = await supabase
    .from('event_reservations')
    .select('id, tenant_id')
    .eq('qr_token', token)
    .maybeSingle();

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }

  let svg = await QRCode.toString(getTicketUrl(token), {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 1,
    width: 260,
    color: { dark: tenant.primary_color, light: '#ffffff' },
  });

  const logoDataUri = tenant.logo_url ? await fetchLogoDataUri(tenant.logo_url) : null;
  svg = overlayCenterBadge(
    svg,
    logoDataUri ? logoBadge(logoDataUri) : initialsBadge(tenant.name, tenant.primary_color),
  );

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
