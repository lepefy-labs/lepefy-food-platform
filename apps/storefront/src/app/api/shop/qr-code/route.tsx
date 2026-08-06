import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import QRCode from 'qrcode';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { getTenant } from '@/lib/tenant/getTenant';

// satori/@resvg/resvg-js richiedono l'ambiente Node (binding nativi per
// resvg), non Edge — stesso pattern già in uso per le route di rendering
// pesante lato server (es. api/admin/card/poster, api/admin/labels/generate).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// .tsx (non .ts, come nel ciclo precedente): l'albero satori è costruito
// via JSX — satori accetta un ReactNode, e TypeScript non riesce a
// verificare che un oggetto letterale scritto a mano `{ type: 'div', props:
// {...} }` soddisfi quel tipo (mancano le proprietà interne di un vero
// ReactElement). JSX con il runtime automatico già in uso nel resto del
// repo (vedi lib/labels/templates/*.tsx) produce elementi realmente
// tipizzati come ReactNode, nessun cast necessario. Next.js supporta
// route.tsx per i Route Handler esattamente come route.ts.

function clampSize(raw: string | null): number {
  const n = parseInt(raw ?? '480', 10);
  if (Number.isNaN(n)) return 480;
  return Math.min(2000, Math.max(200, n));
}

// Copia intenzionale di overlayLogo() da api/card/qr-code/route.ts (non
// importabile: quella route è vincolata a restare invariata, la funzione non
// è esportata). Stessa logica esatta — vedi commento sull'originale.
//
// Bug preesistente noto (non corretto qui, fuori scope, vedi report ciclo
// precedente): coordinate in scala pixel iniettate in un viewBox in
// unità-modulo, logo fuori-viewBox e invisibile a runtime. Presente identico
// anche nella route card/qr-code (segnalata a parte a Robertin). Il
// comportamento resta invariato in questo ciclo: la stringa risultante
// (con o senza overlay funzionante) viene semplicemente incorporata come
// immagine dentro l'albero satori, esattamente come prima veniva annidata
// come <svg> figlio — nessuna interazione tra questo debito tecnico e il
// fix del testo qui applicato.
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

// Font Inter (SIL OFL 1.1) incorporato come bytes letti dal repo — mai una
// lookup di font installati sul sistema operativo del runtime. È esattamente
// questo che risolve il bug "tofu box" osservato in produzione: le funzioni
// serverless di Vercel non hanno font di sistema, quindi qualunque
// `<text font-family="...">` rasterizzato da sharp/librsvg falliva. satori
// disegna il testo come path vettoriali usando SOLO i byte di questo font,
// incorporati nel bundle della funzione — funziona identico a prescindere
// da cosa (se qualcosa) è installato sul sistema del runtime.
//
// Estratto da @fontsource/inter (pnpm add, licenza OFL — vedi
// src/assets/fonts/inter/LICENSE) come asset statico del repo, non letto da
// node_modules a runtime: file copiati una tantum in src/assets/fonts/inter/.
// Formato WOFF (non WOFF2, non TTF/OTF): l'unico formato disponibile in
// @fontsource/inter è woff/woff2, e la versione di satori risolta da
// pnpm-lock.yaml (0.29.0, via @shuding/opentype.js) supporta WOFF ma non
// WOFF2 (nessun decoder Brotli) — verificato empiricamente in questo ciclo,
// non assunto (vedi report).
const FONT_REGULAR = readFileSync(join(process.cwd(), 'src/assets/fonts/inter/Inter-Regular.woff'));
const FONT_BOLD = readFileSync(join(process.cwd(), 'src/assets/fonts/inter/Inter-Bold.woff'));

const CAPTION_TEXT = 'Découvrez notre boutique en ligne';
const COMPAT_TEXT = 'Compatible Android & iPhone';

// Icona smartphone generica (silhouette, path SVG inline) — non i loghi
// ufficiali Google Play/App Store, vedi mockup approvato (ciclo precedente).
function PhoneIcon({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="#6b7280" strokeWidth={2}>
      <rect x={6} y={2} width={12} height={20} rx={2} />
      <line x1={10} y1={19} x2={14} y2={19} />
    </svg>
  );
}

// Albero satori: QR (immagine incorporata via data URI, moduli mai
// ridisegnati) + blocco di testo SOTTO (mai sopra/sovrapposto) — nome
// tenant in grassetto, didascalia statica, riga di compatibilità. Il
// layout flexbox di satori centra la riga icona+testo per costruzione
// (niente più stima della larghezza per conteggio caratteri, a differenza
// della versione precedente basata su tag <text> grezzi in una stringa SVG).
function QrCard({ qrDataUri, size, tenantName }: { qrDataUri: string; size: number; tenantName: string }) {
  const textBlockHeight = Math.round(size * 0.42);
  const totalHeight = size + textBlockHeight;

  // Nome tenant potenzialmente lungo (dato utente, multi-tenant): stesso
  // principio di clamp per lunghezza già usato per il nome prodotto nei
  // template etichetta (lib/labels/templates/default.tsx).
  const nameFontSize = Math.round(size * (tenantName.length > 16 ? 0.052 : 0.072));
  const captionFontSize = Math.round(size * 0.042);
  const compatFontSize = Math.round(size * 0.036);
  const iconSize = Math.round(compatFontSize * 1.2);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: size,
        height: totalHeight,
        backgroundColor: '#ffffff',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrDataUri} width={size} height={size} />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          width: size,
          marginTop: Math.round(textBlockHeight * 0.12),
        }}
      >
        <div style={{ fontFamily: 'Inter', fontWeight: 700, fontSize: nameFontSize, color: '#111827' }}>
          {tenantName}
        </div>
        <div
          style={{
            fontFamily: 'Inter',
            fontWeight: 400,
            fontSize: captionFontSize,
            color: '#6b7280',
            marginTop: Math.round(textBlockHeight * 0.1),
          }}
        >
          {CAPTION_TEXT}
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: Math.round(textBlockHeight * 0.14),
          }}
        >
          <PhoneIcon size={iconSize} />
          <div
            style={{
              fontFamily: 'Inter',
              fontWeight: 400,
              fontSize: compatFontSize,
              color: '#6b7280',
              marginLeft: Math.round(compatFontSize * 0.5),
            }}
          >
            {COMPAT_TEXT}
          </div>
        </div>
      </div>
    </div>
  );
}

// QR (già generato da QRCode.toString, eventualmente già passato da
// overlayLogo) incorporato come immagine — mai ridisegnato — dentro
// l'albero satori. Restituisce un SVG autonomo con il testo come path
// vettoriali (nessun tag <text>, quindi nessuna dipendenza da font di
// sistema al momento del render, in SVG come in PNG).
async function renderSatoriSvg(qrSvg: string, size: number, tenantName: string): Promise<string> {
  const qrDataUri = `data:image/svg+xml;base64,${Buffer.from(qrSvg).toString('base64')}`;
  const totalHeight = size + Math.round(size * 0.42);

  return satori(<QrCard qrDataUri={qrDataUri} size={size} tenantName={tenantName} />, {
    width: size,
    height: totalHeight,
    fonts: [
      { name: 'Inter', data: FONT_REGULAR, weight: 400, style: 'normal' },
      { name: 'Inter', data: FONT_BOLD, weight: 700, style: 'normal' },
    ],
  });
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
  // generazione (fix ciclo precedente) — invariato qui.
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
    // Nessun overlayLogo() in questo ramo (come già prima di questo ciclo:
    // il PNG non ha mai incluso il logo) — evita di introdurre un fetch di
    // rete lato server per un'immagine remota dentro la rasterizzazione,
    // dipendenza nuova non necessaria per questo fix.
    const qrSvg = await QRCode.toString(targetUrl, { ...qrOptions, type: 'svg' });
    const composedSvg = await renderSatoriSvg(qrSvg, size, tenant.name);

    // @resvg/resvg-js al posto di sharp per questo passaggio: stessa
    // libreria dietro next/og, pensata per rasterizzare in modo affidabile
    // un SVG prodotto da satori (path vettoriali) senza dipendere da font
    // di sistema.
    const resvg = new Resvg(composedSvg, { fitTo: { mode: 'original' } });
    const buffer = resvg.render().asPng();

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

  const svg = await renderSatoriSvg(qrSvg, size, tenant.name);

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
