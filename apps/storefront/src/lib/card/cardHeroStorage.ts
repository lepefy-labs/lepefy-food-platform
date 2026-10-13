import type { SupabaseClient } from '@supabase/supabase-js';

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
