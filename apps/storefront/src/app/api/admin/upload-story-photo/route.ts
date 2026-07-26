import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Upload de la photo illustrant la section "Notre origine" (home). Même
// pattern que upload-product-image/upload-label-asset : resize sharp, upload
// bucket `assets`, cache-busting `?v=` (path déterministe via upsert).
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const formData = await req.formData();
  const file       = formData.get('file') as File | null;
  const tenantId   = formData.get('tenantId') as string | null;

  if (!file || !tenantId) {
    return NextResponse.json({ error: 'Missing file or tenantId' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const buffer   = Buffer.from(await file.arrayBuffer());
  const ext         = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const contentType = file.type;

  const resized = await sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .toBuffer();

  const path = `story/${tenantId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('assets')
    .upload(path, resized, { contentType, upsert: true });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const imageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}?v=${Date.now()}`;

  const { error: dbErr } = await supabase
    .from('tenants')
    .update({ story_image_url: imageUrl })
    .eq('id', tenantId);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ imageUrl });
}
