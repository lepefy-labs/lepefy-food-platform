import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Upload générique pour les images du module Événementiel et les slides
// éditoriales de la home (bannière événement, tarifs sur place, galerie,
// location, couverture de service, hero) — même pattern que les autres
// uploads : resize sharp, bucket `assets`, chemin tenant-scoped par kind + uuid.
const VALID_KINDS = ['event-banner', 'event-price-list', 'gallery', 'rental-item', 'service-cover', 'hero-slide'] as const;
type Kind = typeof VALID_KINDS[number];

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const kind = formData.get('kind') as string | null;

  if (!file || !kind || !VALID_KINDS.includes(kind as Kind)) {
    return NextResponse.json({ error: 'Fichier et type valides requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const buffer   = Buffer.from(await file.arrayBuffer());
  const ext         = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const contentType = file.type;

  const resized = await sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .toBuffer();

  const path = `events/${tenant.id}/${kind}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('assets')
    .upload(path, resized, { contentType, upsert: true });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const imageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;

  return NextResponse.json({ imageUrl });
}
