import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { removeBackground } from '@/lib/images/removeBackground';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant     = await getTenant(tenantSlug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const formData        = await req.formData();
  const file             = formData.get('file') as File | null;
  const productId        = formData.get('productId') as string | null;
  const slug              = formData.get('slug') as string | null;
  const shouldRemoveBg    = formData.get('removeBackground') === 'true';

  if (!file || !productId || !slug) {
    return NextResponse.json(
      { error: 'Missing file, productId or slug' },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();
  let buffer: Buffer = Buffer.from(await file.arrayBuffer());
  let ext        =
    file.type === 'image/png'  ? 'png'  :
    file.type === 'image/webp' ? 'webp' :
    'jpg';
  let contentType = file.type;

  if (shouldRemoveBg) {
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

  // Resize côté serveur — les photos prises au téléphone dépassent souvent
  // 3000px de large ; on limite à 1600px sans jamais agrandir une image plus
  // petite. Le format de sortie reste celui déterminé plus haut (pas de
  // conversion ici).
  const resized = await sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .toBuffer();

  const path = `products/${slug}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from('assets')
    .upload(path, resized, { contentType, upsert: true });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // Cache-busting : le path reste identique à chaque ré-upload (upsert:true),
  // donc sans ce paramètre l'ancienne image resterait servie depuis le cache
  // CDN/Next Image jusqu'à minimumCacheTTL (7 jours).
  const imageUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}?v=${Date.now()}`;

  const { error: dbErr } = await supabase
    .from('products')
    .update({ image_url: imageUrl })
    .eq('id', productId);

  if (dbErr) {
    return NextResponse.json({ error: dbErr.message }, { status: 500 });
  }

  return NextResponse.json({ imageUrl });
}
