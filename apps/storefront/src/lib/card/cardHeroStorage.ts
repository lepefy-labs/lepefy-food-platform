import type sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { HERO_UPLOAD_WIDTHS } from './cardHero';

/** Dossier des photos de hero téléversées, un par tenant (bucket public `assets`). */
export const CARD_HERO_BUCKET = 'assets';
export const cardHeroFolder = (tenantId: string) => `card-hero/${tenantId}`;

/**
 * Supprime les variantes d'anciennes versions (tout sauf `keepPrefix`).
 * Best-effort : un échec ne doit jamais annuler l'enregistrement qui vient de réussir.
 */
export async function removeOldHeroVariants(db: SupabaseClient, tenantId: string, keepPrefix: string | null): Promise<void> {
  try {
    const folder = cardHeroFolder(tenantId);
    const { data } = await db.storage.from(CARD_HERO_BUCKET).list(folder, { limit: 100 });
    const stale = (data ?? []).map((file) => file.name).filter((name) => !keepPrefix || !name.startsWith(keepPrefix));
    if (stale.length > 0) await db.storage.from(CARD_HERO_BUCKET).remove(stale.map((name) => `${folder}/${name}`));
  } catch (error) {
    console.warn('[card hero] old variants not removed:', error instanceof Error ? error.message : error);
  }
}

/** Supprime une version précise (téléversement interrompu) sans toucher la photo en ligne. */
export async function removeHeroVersion(db: SupabaseClient, tenantId: string, version: string): Promise<void> {
  try {
    const folder = cardHeroFolder(tenantId);
    const { data } = await db.storage.from(CARD_HERO_BUCKET).list(folder, { limit: 100 });
    const files = (data ?? []).map((file) => file.name).filter((name) => name.startsWith(`${version}-`));
    if (files.length > 0) await db.storage.from(CARD_HERO_BUCKET).remove(files.map((name) => `${folder}/${name}`));
  } catch (error) {
    console.warn('[card hero] partial upload not removed:', error instanceof Error ? error.message : error);
  }
}

/**
 * Writes the AVIF + WebP variants of one hero version (480/800/1200 px, never
 * enlarged) and returns the public base and widths. Shared by the /card upload
 * and the Studio images. On failure the partial version is removed and the
 * error is rethrown: the live photo is never touched.
 */
export async function storeHeroVariants(
  db: SupabaseClient,
  tenantId: string,
  source: sharp.Sharp,
  width: number,
): Promise<{ base: string; widths: number[]; version: string; paths: string[] }> {
  const widths: number[] = HERO_UPLOAD_WIDTHS.filter((w) => w <= width);
  if (widths.length === 0 || (widths[widths.length - 1]! < width && widths.length < HERO_UPLOAD_WIDTHS.length)) widths.push(width);
  const version = `v${Date.now()}`;
  const folder = cardHeroFolder(tenantId);
  const paths: string[] = [];
  try {
    for (const w of widths) {
      const resized = source.clone().resize({ width: w, withoutEnlargement: true });
      const [webp, avif] = await Promise.all([
        resized.clone().webp({ quality: 80 }).toBuffer(),
        resized.clone().avif({ quality: 55 }).toBuffer(),
      ]);
      for (const [ext, body, contentType] of [['webp', webp, 'image/webp'], ['avif', avif, 'image/avif']] as const) {
        const path = `${folder}/${version}-${w}.${ext}`;
        const { error } = await db.storage.from(CARD_HERO_BUCKET).upload(path, body, { contentType, upsert: true, cacheControl: '31536000' });
        if (error) throw new Error(error.message);
        paths.push(path);
      }
    }
  } catch (error) {
    await removeHeroVersion(db, tenantId, version);
    throw error;
  }
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${CARD_HERO_BUCKET}/${folder}/${version}`;
  return { base, widths, version, paths };
}
