import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { withStorefrontInvalidation } from '@/lib/cache/withStorefrontInvalidation';
import { updateModuleConfig } from '@/lib/tenantConfig/moduleConfig';
import { digitalCardModule } from '@/lib/card/digitalCardSettings';
import { HERO_UPLOAD_WIDTHS } from '@/lib/card/cardHero';
import { CARD_HERO_BUCKET, cardHeroFolder, removeHeroVersion, removeOldHeroVariants } from '@/lib/card/cardHeroStorage';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MIN_WIDTH = 480;

/**
 * Photo de la hero /card (Contenu public). Variantes AVIF + WebP générées ici
 * (480/800/1200 px, jamais agrandies) et servies telles quelles depuis le
 * stockage public : la hero n'utilise jamais `/_next/image` (quota Vercel
 * épuisée → 402). Version horodatée dans le nom (pas de cache périmé), les
 * variantes précédentes sont supprimées après l'enregistrement.
 */
async function handlePOST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Aucune photo reçue.' }, { status: 400 });
  if (!ACCEPTED.has(file.type)) return NextResponse.json({ error: 'Format non pris en charge : JPEG, PNG, WebP ou AVIF.' }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Photo trop lourde (15 Mo maximum).' }, { status: 413 });

  let source: sharp.Sharp;
  let width: number;
  try {
    source = sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'error' }).rotate();
    const meta = await source.metadata();
    // Après rotation EXIF, une photo portrait a largeur/hauteur inversées.
    width = (meta.orientation && meta.orientation >= 5 ? meta.height : meta.width) ?? 0;
  } catch {
    return NextResponse.json({ error: 'Photo illisible.' }, { status: 400 });
  }
  if (width < MIN_WIDTH) return NextResponse.json({ error: `Photo trop petite : ${MIN_WIDTH} px de large minimum.` }, { status: 400 });

  const widths: number[] = HERO_UPLOAD_WIDTHS.filter((w) => w <= width);
  if (widths.length === 0 || (widths[widths.length - 1]! < width && widths.length < HERO_UPLOAD_WIDTHS.length)) widths.push(width);
  const version = `v${Date.now()}`;
  const folder = cardHeroFolder(tenant.id);
  const db = createServiceClient();

  try {
    for (const w of widths) {
      const resized = source.clone().resize({ width: w, withoutEnlargement: true });
      const [webp, avif] = await Promise.all([
        resized.clone().webp({ quality: 80 }).toBuffer(),
        resized.clone().avif({ quality: 55 }).toBuffer(),
      ]);
      for (const [ext, body, contentType] of [['webp', webp, 'image/webp'], ['avif', avif, 'image/avif']] as const) {
        const { error } = await db.storage.from(CARD_HERO_BUCKET).upload(`${folder}/${version}-${w}.${ext}`, body, {
          contentType, upsert: true, cacheControl: '31536000',
        });
        if (error) throw new Error(error.message);
      }
    }
  } catch (error) {
    console.error('[card hero] upload failed', tenant.id, error instanceof Error ? error.message : error);
    await removeHeroVersion(db, tenant.id, version);
    return NextResponse.json({ error: 'Téléversement impossible. Réessayez.' }, { status: 500 });
  }

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${CARD_HERO_BUCKET}/${folder}/${version}`;
  try {
    const state = await updateModuleConfig(db, digitalCardModule, tenant.id, {
      config: { hero_image_base: base, hero_image_widths: widths, hero_image_url: null },
    });
    await removeOldHeroVariants(db, tenant.id, `${version}-`);
    return NextResponse.json({ config: state.config });
  } catch (error) {
    console.error('[card hero] settings update failed', tenant.id, error instanceof Error ? error.message : error);
    await removeHeroVersion(db, tenant.id, version);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }
}

export const POST = withStorefrontInvalidation(['tenant'], handlePOST);
