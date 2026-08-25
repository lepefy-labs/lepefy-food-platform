import { access, writeFile } from 'node:fs/promises';
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
const SOCIAL_FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/prompt/Prompt-Regular.ttf';
const SOCIAL_FONT_PATH = '/tmp/lepefy-social-prompt-regular.ttf';
const SOCIAL_FONT_FAMILY = 'Prompt';
let socialFontPromise: Promise<string> | null = null;

function escapeMarkup(value: string) {
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

async function ensureSocialFont() {
  if (!socialFontPromise) {
    socialFontPromise = (async () => {
      try {
        await access(SOCIAL_FONT_PATH);
        return SOCIAL_FONT_PATH;
      } catch {
        const response = await fetch(SOCIAL_FONT_URL, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`social-font-unavailable:${response.status}`);
        await writeFile(SOCIAL_FONT_PATH, Buffer.from(await response.arrayBuffer()));
        return SOCIAL_FONT_PATH;
      }
    })();
  }
  return socialFontPromise;
}

interface TextLayerOptions {
  text: string;
  width: number;
  height: number;
  fontSize: number;
  weight: number;
  color: string;
  align?: 'left' | 'centre' | 'right';
}

async function renderTextLayer(fontPath: string, options: TextLayerOptions) {
  const markup = `<span foreground="${options.color}" weight="${options.weight}">${escapeMarkup(options.text)}</span>`;
  return sharp({
    text: {
      text: markup,
      font: `${SOCIAL_FONT_FAMILY} ${options.fontSize}`,
      fontfile: fontPath,
      width: options.width,
      height: options.height,
      align: options.align ?? 'left',
      rgba: true,
    },
  }).png().toBuffer();
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
  const shapes = `
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
      <rect x="70" y="${detailStartY}" width="940" height="2" fill="#ffffff" opacity="0.28"/>
      <rect x="70" y="1754" width="940" height="86" rx="24" fill="#ffffff" fill-opacity="0.94"/>
    </svg>`;

  try {
    const fontPath = await ensureSocialFont();
    const titleText = titleLines.join('\n');
    const locationText = locationLines.join('\n');
    const [brandLayer, titleLayer, dateLayer, timeLayer, locationLayer, ctaLayer, hostLayer] = await Promise.all([
      renderTextLayer(fontPath, {
        text: `${tenant.name} • EVENTS`,
        width: 300,
        height: 52,
        fontSize: 30,
        weight: 700,
        color: '#ffffff',
        align: 'centre',
      }),
      renderTextLayer(fontPath, {
        text: titleText,
        width: 940,
        height: Math.max(100, titleLines.length * 94),
        fontSize: 78,
        weight: 800,
        color: '#ffffff',
      }),
      renderTextLayer(fontPath, {
        text: dateLabel,
        width: 940,
        height: 55,
        fontSize: 37,
        weight: 700,
        color: secondary,
      }),
      renderTextLayer(fontPath, {
        text: timeLabel,
        width: 940,
        height: 50,
        fontSize: 34,
        weight: 600,
        color: '#ffffff',
      }),
      locationText
        ? renderTextLayer(fontPath, {
            text: locationText,
            width: 940,
            height: Math.max(52, locationLines.length * 48),
            fontSize: 31,
            weight: 500,
            color: '#ffffff',
          })
        : Promise.resolve(null),
      renderTextLayer(fontPath, {
        text: 'Réserve ta place',
        width: 430,
        height: 52,
        fontSize: 31,
        weight: 800,
        color: primary,
      }),
      renderTextLayer(fontPath, {
        text: host,
        width: 380,
        height: 44,
        fontSize: 23,
        weight: 600,
        color: '#333333',
        align: 'right',
      }),
    ]);

    const overlays: sharp.OverlayOptions[] = [
      { input: Buffer.from(shapes) },
      { input: brandLayer, left: 85, top: 92 },
      { input: titleLayer, left: 70, top: titleStartY - 72 },
      { input: dateLayer, left: 70, top: detailStartY + 34 },
      { input: timeLayer, left: 70, top: detailStartY + 88 },
      { input: ctaLayer, left: 105, top: 1773 },
      { input: hostLayer, left: 595, top: 1778 },
    ];
    if (locationLayer) overlays.push({ input: locationLayer, left: 70, top: detailStartY + 146 });

    const png = await sharp(imageBuffer)
      .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'centre' })
      .composite(overlays)
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
  } catch (error) {
    console.error('[social-card] generation failed', error);
    return NextResponse.json({ error: 'Impossible de générer la story.' }, { status: 500 });
  }
}
