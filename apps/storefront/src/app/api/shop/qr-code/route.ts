import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { getTenant } from '@/lib/tenant/getTenant';

export const dynamic = 'force-dynamic';

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '480', 10);
  if (Number.isNaN(n)) return 480;
  return Math.min(2000, Math.max(200, n));
}

// Copia intenzionale di overlayLogo() da api/card/qr-code/route.ts (non
// importabile: quella route è vincolata a restare invariata, la funzione non
// è esportata). Stessa logica esatta — vedi commento sull'originale.
//
// NOTA scoperta in questo ciclo (non corretta qui, fuori scope): questa
// funzione inietta coordinate in scala pixel (es. boxPos ≈ size*0.39) come
// figli diretti dell'<svg> del QR, il cui viewBox reale è in unità-modulo
// (es. "0 0 43 43", non "0 0 size size" — QRCode.toString imposta
// width/height in pixel ma lascia il viewBox in unità modulo). Il logo
// risulta quindi fuori-viewBox e invisibile a runtime — verificato
// renderizzando un logo di prova (quadrato rosso) e rasterizzando: nessuna
// traccia nel PNG risultante. Bug preesistente, presente identico anche
// nella route card/qr-code (segnalata a parte a Robertin, fuori scope): non
// toccato qui per restare nel perimetro di questo ciclo (dominio + testo).
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

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Stack sans-serif di sistema già in uso nel repo (globals.css, regola
// @media print body) — nessun nuovo web font introdotto: questa route
// produce SVG/PNG lato server (rasterizzato da sharp/librsvg), non può
// caricare un font Google Fonts come nel mockup HTML di riferimento.
const FONT_FAMILY = 'Arial, Helvetica, sans-serif';
const CAPTION_TEXT = 'Découvrez notre boutique en ligne';
const COMPAT_TEXT = 'Compatible Android & iPhone';

// Blocco di testo SOTTO il QR (mai sopra/sovrapposto, mai dentro l'area dei
// moduli): nome tenant in grassetto, didascalia statica di prodotto, riga di
// compatibilità con icona smartphone generica (path SVG inline — niente
// loghi ufficiali Google Play/App Store, vedi mockup approvato). Ritorna
// anche l'altezza totale del nuovo canvas: il QR resta a `size`, invariato.
function buildTextBlock(size: number, tenantName: string): { markup: string; totalHeight: number } {
  const textBlockHeight = Math.round(size * 0.42);
  const totalHeight = size + textBlockHeight;

  // Nome tenant potenzialmente lungo (dato utente, multi-tenant): stesso
  // principio di clamp per lunghezza già usato per il nome prodotto nei
  // template etichetta (lib/labels/templates/default.tsx), qui a due
  // scalini invece di un clamp continuo — sufficiente per un titolo su
  // singola riga, nessun bisogno di wrapping multi-riga in questo contesto.
  const nameFontSize = Math.round(size * (tenantName.length > 16 ? 0.052 : 0.072));
  const captionFontSize = Math.round(size * 0.042);
  const compatFontSize = Math.round(size * 0.036);

  const nameY = size + Math.round(textBlockHeight * 0.32);
  const captionY = size + Math.round(textBlockHeight * 0.55);
  const compatY = size + Math.round(textBlockHeight * 0.82);

  // Nessun motore di misura testo reale in questa pipeline (niente
  // browser/Chromium, solo stringa SVG + rasterizzazione sharp): la
  // larghezza della riga "compat" (icona + testo) per centrarla è stimata
  // via conteggio caratteri, stesso principio già usato in
  // lib/labels/templates/default.tsx per dimensionare il nome prodotto.
  const iconH = Math.round(compatFontSize * 1.3);
  const iconW = Math.round(iconH * 0.6);
  const gap = Math.round(compatFontSize * 0.5);
  const estTextW = Math.round(COMPAT_TEXT.length * compatFontSize * 0.52);
  const rowX = Math.round(size / 2 - (iconW + gap + estTextW) / 2);

  const markup = `
    <text x="${size / 2}" y="${nameY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="700" font-size="${nameFontSize}" fill="#111827">${escapeXml(tenantName)}</text>
    <text x="${size / 2}" y="${captionY}" text-anchor="middle" font-family="${FONT_FAMILY}" font-weight="400" font-size="${captionFontSize}" fill="#6b7280">${escapeXml(CAPTION_TEXT)}</text>
    <g transform="translate(${rowX}, ${compatY - iconH})">
      <rect x="0" y="0" width="${iconW}" height="${iconH}" rx="${Math.round(iconW * 0.22)}" fill="none" stroke="#6b7280" stroke-width="1.4" />
      <line x1="${Math.round(iconW * 0.28)}" y1="${Math.round(iconH * 0.87)}" x2="${Math.round(iconW * 0.72)}" y2="${Math.round(iconH * 0.87)}" stroke="#6b7280" stroke-width="1.4" stroke-linecap="round" />
      <text x="${iconW + gap}" y="${Math.round(iconH * 0.8)}" font-family="${FONT_FAMILY}" font-size="${compatFontSize}" fill="#6b7280">${escapeXml(COMPAT_TEXT)}</text>
    </g>`;

  return { markup, totalHeight };
}

// Compone QR (a `size`, moduli intatti) + testo sotto in un unico canvas SVG
// più alto. Il QR è annidato come <svg> figlio invariato (stessa stringa
// generata da QRCode.toString, eventualmente già passata da overlayLogo):
// il suo viewBox è in unità-modulo, non in pixel — annidarlo con i propri
// width/height="{size}" gli fa applicare la propria scala interna
// correttamente, invece di reinterpretare a mano le sue coordinate nel
// sistema pixel del canvas esterno (la causa del bug di overlayLogo sopra).
function composeSvg(qrSvg: string, size: number, tenantName: string): string {
  const { markup, totalHeight } = buildTextBlock(size, tenantName);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${totalHeight}" viewBox="0 0 ${size} ${totalHeight}"><rect width="${size}" height="${totalHeight}" fill="#ffffff" />${qrSvg}${markup}</svg>`;
}

export async function GET(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') === 'png' ? 'png' : 'svg';
  const size = clampSize(searchParams.get('size'));
  const forceDownload = searchParams.get('download') === '1';

  const darkParam = searchParams.get('dark');
  const darkColor = darkParam && /^[0-9a-fA-F]{6}$/.test(darkParam) ? `#${darkParam}` : tenant.primary_color;

  // Dominio canonico da env, mai dall'host che ha servito la richiesta di
  // generazione: req.nextUrl.origin rifletteva l'host reale (es. il dominio
  // .vercel.app di anteprima), non il dominio custom del tenant — bug
  // riportato dopo test reale. Stesso pattern già in uso in
  // card/vcard/route.ts. Fallback su req.nextUrl.origin solo come rete di
  // sicurezza, mai un URL vuoto.
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const targetUrl = `${siteUrl}/go?t=${tenant.slug}&src=qr_shop`;

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
    // QRCode.toBuffer() genera un raster puro via pngjs, senza alcuna
    // capacità di disegnare testo: per ottenere lo stesso blocco sotto sia
    // in PNG sia in SVG, il PNG è qui rasterizzato da sharp a partire dallo
    // STESSO SVG composto (QR + testo) usato per il formato SVG — garantisce
    // equivalenza visiva reale, non solo nominale.
    // Nessun overlayLogo() in questo ramo (come già oggi: il PNG esistente
    // non ha mai incluso il logo) — evita anche di introdurre un fetch di
    // rete lato server per un'immagine remota dentro la rasterizzazione
    // SVG→PNG, dipendenza nuova non necessaria per questo fix.
    const qrSvg = await QRCode.toString(targetUrl, { ...qrOptions, type: 'svg' });
    const composedSvg = composeSvg(qrSvg, size, tenant.name);
    const buffer = await sharp(Buffer.from(composedSvg)).png().toBuffer();

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': forceDownload
          ? `attachment; filename="${tenant.slug}-shop-qr.png"`
          : 'inline',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  }

  let qrSvg = await QRCode.toString(targetUrl, { ...qrOptions, type: 'svg' });

  if (tenant.logo_url) {
    qrSvg = overlayLogo(qrSvg, size, tenant.logo_url);
  }

  const svg = composeSvg(qrSvg, size, tenant.name);

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Content-Disposition': forceDownload
        ? `attachment; filename="${tenant.slug}-shop-qr.svg"`
        : 'inline',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
