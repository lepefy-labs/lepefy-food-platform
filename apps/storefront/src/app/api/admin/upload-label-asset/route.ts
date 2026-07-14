import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { removeBackground } from '@/lib/images/removeBackground';

export const runtime = 'nodejs';
export const maxDuration = 30;

// target: 'tenant-logo' | 'category-background' | 'product-background'
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const formData     = await req.formData();
  const file          = formData.get('file') as File | null;
  const target         = formData.get('target') as string | null;
  const entityId       = formData.get('entityId') as string | null;
  const shouldRemoveBg = formData.get('removeBackground') === 'true';

  if (!file || !target || !entityId) {
    return NextResponse.json({ error: 'Missing file, target or entityId' }, { status: 400 });
  }

  const supabase = createServiceClient();
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let ext         = file.type === 'image/png' ? 'png' : file.type === 'image/svg+xml' ? 'svg' : 'jpg';
  let contentType = file.type;

  if (shouldRemoveBg && ext !== 'svg') {
    try {
      buffer      = await removeBackground(buffer, file.name);
      ext         = 'png';
      contentType = 'image/png';
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? `Suppression du fond échouée: ${err.message}` : 'Suppression du fond échouée' },
        { status: 500 }
      );
    }
  }

  const path = `labels/${target}-${entityId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('assets')
    .upload(path, buffer, { contentType, upsert: true });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  // Storage path is deterministic (upsert on the same key), so append a cache-busting
  // query param — otherwise browsers/CDN keep serving the previous image after a re-upload.
  const assetUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}?v=${Date.now()}`;

  const updateMap: Record<string, { table: string; column: string }> = {
    'tenant-logo':          { table: 'tenants',    column: 'label_logo_url' },
    'category-background':  { table: 'categories', column: 'label_background_image_url' },
    'product-background':   { table: 'products',   column: 'label_background_image_url' },
  };

  const mapping = updateMap[target];
  if (!mapping) return NextResponse.json({ error: 'Target non valido' }, { status: 400 });

  const { error: dbErr } = await supabase
    .from(mapping.table)
    .update({ [mapping.column]: assetUrl })
    .eq('id', entityId);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({ assetUrl });
}
