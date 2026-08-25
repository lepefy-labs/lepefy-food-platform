import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createPublicClient } from '@/lib/supabase/public';
import { getTenant } from '@/lib/tenant/getTenant';
import type { EventGalleryPhoto, EventRow } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const WIDTH = 1080;
const HEIGHT = 1920;
const DEFAULT_PRIMARY = '#E65C00';
const DEFAULT_SECONDARY = '#FFB347';
const SOCIAL_CARD_FONT = 'DejaVu Sans, sans-serif';

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(value: string, maxChars: number, maxLines: number) {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function textLines(lines: string[], x: number, y: number, lineHeight: number, fontSize: number, weight: number, fill: string) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" font-family="${SOCIAL_CARD_FONT}" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join('');
}

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const photoId = req.nextUrl.searchParams.get('photo')?.trim();
  if (!photoId) return NextResponse.json({ error: 'Photo requise.' }, { status: 400 });

  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  if (!tenant.events_enabled) return NextResponse.json({ error: 'Module indisponible.' }, { status: 404 });

  const supabase = createPublicClient();
  const [{ data: eventData }, { data: photoData }] = await Promise.all([
    supabase
      .from('events')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('slug', params.slug)
      .eq('status', 'published')
      .maybeSingle(),
    supabase
      .from('event_gallery_photos')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('id', photoId)
      .maybeSingle(),
  ]);

  if (!eventData || !photoData) return NextResponse.json({ error: 'Événement ou photo introuvable.' }, { status: 404 });
  const event = eventData as EventRow;
  const photo = photoData as EventGalleryPhoto;
  if (photo.event_id !== event.id || !Boolean(photo.is_social_share)) {
    return NextResponse.json({ error: 'Cette photo n’est pas autorisée pour le partage.' }, { status: 404 });
  }

  let imageUrl: URL;
  try {
    imageUrl = new URL(photo.image_url);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) throw new Error('invalid-protocol');
  } catch {
    return NextResponse.json({ error: 'Image invalide.' }, { status: 422 });
  }

  const imageResponse = await fetch(imageUrl, { cache: 'force-cache' });
  if (!imageResponse.ok || !imageResponse.headers.get('content-type')?.startsWith('image/')) {
    return NextResponse.json({ error: 'Image source indisponible.' }, { status: 502 });
  }
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

  const date = new Date(event.date_start);
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const timeLabel = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
  const primary = event.theme_primary_color ?? DEFAULT_PRIMARY;
  const secondary = event.theme_secondary_color ?? DEFAULT_SECONDARY;
  const titleLines = wrapText(event.title, 24, 3);
  const locationLines = event.location ? wrapText(event.location, 36, 2) : [];
  const host = req.nextUrl.host.replace(/^www\./, '');

  const titleStartY = 1310 - Math.max(0, titleLines.length - 1) * 34;
  const detailStartY = titleStartY + titleLines.length * 94 + 54;
  const overlay = `
    <svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.06"/>
          <stop offset="46%" stop-color="#000000" stop-opacity="0.10"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.92"/>
        </linearGradient>
      </defs>
      <rect width="1080" height="1920" fill="url(#shade)"/>
      <rect x="70" y="82" width="330" height="70" rx="35" fill="${primary}"/>
      <text x="235" y="128" text-anchor="middle" font-family="${SOCIAL_CARD_FONT}" font-size="30" font-weight="700" fill="#ffffff">${escapeXml(tenant.name)} • EVENTS</text>
      ${textLines(titleLines, 70, titleStartY, 94, 78, 800, '#ffffff')}
      <rect x="70" y="${detailStartY}" width="940" height="2" fill="#ffffff" opacity="0.28"/>
      <text x="70" y="${detailStartY + 70}" font-family="${SOCIAL_CARD_FONT}" font-size="37" font-weight="700" fill="${secondary}">${escapeXml(dateLabel)}</text>
      <text x="70" y="${detailStartY + 124}" font-family="${SOCIAL_CARD_FONT}" font-size="34" font-weight="600" fill="#ffffff">${escapeXml(timeLabel)}</text>
      ${locationLines.length ? textLines(locationLines, 70, detailStartY + 184, 48, 31, 500, '#ffffff') : ''}
      <rect x="70" y="1754" width="940" height="86" rx="24" fill="#ffffff" fill-opacity="0.94"/>
      <text x="105" y="1809" font-family="${SOCIAL_CARD_FONT}" font-size="31" font-weight="800" fill="${primary}">Réserve ta place</text>
      <text x="975" y="1809" text-anchor="end" font-family="${SOCIAL_CARD_FONT}" font-size="23" font-weight="600" fill="#333333">${escapeXml(host)}</text>
    </svg>`;

  try {
    const png = await sharp(imageBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .composite([{ input: Buffer.from(overlay) }])
      .png({ quality: 92 })
      .toBuffer();

    return new NextResponse(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="${event.slug}-story.png"`,
        'Cache-Control': 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Impossible de générer la story.' }, { status: 500 });
  }
}
