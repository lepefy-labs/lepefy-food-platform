import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { APP_ICON_MAX_BYTES, validateAppIconMetadata } from '@/lib/tenant/appIcon';

export const runtime = 'nodejs';
export const maxDuration = 30;
const ASSETS_BUCKET = 'assets';
const storagePath = (tenantId: string) => `branding/${tenantId}/app-icon.png`;

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  let file: File;
  try {
    const candidate = (await req.formData()).get('file');
    if (!(candidate instanceof File)) return NextResponse.json({ error: 'Fichier manquant.' }, { status: 400 });
    file = candidate;
  } catch {
    return NextResponse.json({ error: 'Formulaire invalide.' }, { status: 400 });
  }

  if (file.size > APP_ICON_MAX_BYTES) {
    return NextResponse.json({ error: 'Le fichier ne doit pas dépasser 1 Mo.' }, { status: 413 });
  }

  const input = Buffer.from(await file.arrayBuffer());
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { failOn: 'error' }).metadata();
  } catch {
    return NextResponse.json({ error: 'Le fichier doit être une image PNG valide.' }, { status: 400 });
  }

  const validationError = validateAppIconMetadata({
    mimeType: file.type, byteLength: file.size, format: metadata.format,
    width: metadata.width, height: metadata.height, pages: metadata.pages,
  });
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  const output = await sharp(input, { failOn: 'error' }).png().toBuffer();
  if (output.byteLength > APP_ICON_MAX_BYTES) {
    return NextResponse.json({ error: 'L’image PNG normalisée dépasse 1 Mo.' }, { status: 413 });
  }

  const supabase = createServiceClient();
  const path = storagePath(tenant.id);
  const { error: uploadError } = await supabase.storage.from(ASSETS_BUCKET)
    .upload(path, output, { contentType: 'image/png', cacheControl: '31536000', upsert: true });
  if (uploadError) return NextResponse.json({ error: 'Impossible d’enregistrer l’icône.' }, { status: 500 });

  const { data: publicData } = supabase.storage.from(ASSETS_BUCKET).getPublicUrl(path);
  const versionedUrl = new URL(publicData.publicUrl);
  versionedUrl.searchParams.set('v', String(Date.now()));
  const appIconUrl = versionedUrl.toString();

  const { error: updateError } = await supabase.from('tenants')
    .update({ app_icon_url: appIconUrl }).eq('id', tenant.id);
  if (updateError) return NextResponse.json({ error: 'Impossible d’associer l’icône à la boutique.' }, { status: 500 });

  return NextResponse.json({ appIconUrl });
}

export async function DELETE() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { error: updateError } = await supabase.from('tenants')
    .update({ app_icon_url: null }).eq('id', tenant.id);
  if (updateError) return NextResponse.json({ error: 'Impossible de rétablir le logo de la boutique.' }, { status: 500 });

  // Reset is DB-first. Storage cleanup is best-effort and cannot block logo_url fallback.
  const { error: removeError } = await supabase.storage.from(ASSETS_BUCKET).remove([storagePath(tenant.id)]);
  if (removeError) console.warn('[admin/app-icon] Orphaned deterministic asset:', removeError.message);

  return NextResponse.json({ success: true });
}
