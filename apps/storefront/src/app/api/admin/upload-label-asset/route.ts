import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';

// target: 'tenant-logo' | 'category-background' | 'product-background'
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const formData = await req.formData();
  const file      = formData.get('file') as File | null;
  const target    = formData.get('target') as string | null;
  const entityId  = formData.get('entityId') as string | null; // tenantId | categoryId | productId

  if (!file || !target || !entityId) {
    return NextResponse.json({ error: 'Missing file, target or entityId' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const buffer   = Buffer.from(await file.arrayBuffer());
  const ext      = file.type === 'image/png' ? 'png' : file.type === 'image/svg+xml' ? 'svg' : 'jpg';
  const path     = `labels/${target}-${entityId}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('assets')
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const assetUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;

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
