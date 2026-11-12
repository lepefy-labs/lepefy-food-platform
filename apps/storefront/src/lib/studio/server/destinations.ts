import 'server-only';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Tenant } from '@lepefy/types';
import { uploadProductImageSet } from '@/lib/images/productImagePipeline';
import { MAX_PRODUCT_IMAGES, normalizeProductImages } from '@/lib/catalog/productImages';
import { revalidateCatalogCache, revalidateTenantCache } from '@/lib/cache/storefrontCache';
import { updateModuleConfig, readModuleConfig } from '@/lib/tenantConfig/moduleConfig';
import { digitalCardModule } from '@/lib/card/digitalCardSettings';
import { removeOldHeroVariants, storeHeroVariants } from '@/lib/card/cardHeroStorage';
import { STUDIO_PUBLIC_BUCKET } from '../domain';
import { SINGLETON_TARGET, type StudioDestinationKey } from '../destinations';

/**
 * Server side of the destination registry. Each slot implements:
 *   targets  → what the admin can pick (always filtered by tenant_id);
 *   store    → COPY of the prepared image in the slot's public folder
 *              (one copy per usage: removing one never breaks another);
 *   attach   → safe reference update: compare-and-set on the value read
 *              before, so a concurrent edit of the slot is never overwritten;
 *   detach   → clears the reference only if it still points to our copy.
 * Product images follow the product rule (immutable v3 sets, detach only).
 */

export interface DestinationTarget { id: string; label: string; detail?: string | null; imageUrl?: string | null }
export interface StoredCopy { publicUrl: string; paths: string[]; extra?: Record<string, unknown> }
export type AttachOutcome = 'ok' | 'conflict' | 'full' | 'missing';

export interface DestinationImpl {
  targets(db: SupabaseClient, tenant: Tenant, q: string | null): Promise<DestinationTarget[]>;
  target(db: SupabaseClient, tenant: Tenant, targetId: string): Promise<DestinationTarget | null>;
  store(db: SupabaseClient, tenant: Tenant, targetId: string, image: Buffer): Promise<StoredCopy>;
  attach(db: SupabaseClient, tenant: Tenant, targetId: string, copy: StoredCopy, options: { asCover: boolean }): Promise<AttachOutcome>;
  /** true: the slot pointed to our copy and no longer does. */
  detach(db: SupabaseClient, tenant: Tenant, targetId: string, publicUrl: string): Promise<boolean>;
  /** Our copy may be deleted once detached (false for products: immutable shared sets). */
  deleteCopy: boolean;
  revalidate(db: SupabaseClient, tenant: Tenant, targetId: string): Promise<void>;
}

const publicUrl = (path: string) => `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${STUDIO_PUBLIC_BUCKET}/${path}`;
const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;

async function putPublic(db: SupabaseClient, path: string, bytes: Buffer): Promise<void> {
  const { error } = await db.storage.from(STUDIO_PUBLIC_BUCKET).upload(path, bytes, { contentType: 'image/webp', upsert: false, cacheControl: '31536000' });
  if (error) throw new Error('copy_failed');
}

/** Simple slot: one WebP copy under tenants/<t>/<folder>/<target>/<uuid>.webp. */
async function storeSimple(db: SupabaseClient, tenantId: string, folder: string, targetId: string, image: Buffer): Promise<StoredCopy> {
  const path = `tenants/${tenantId}/${folder}/${targetId}/${randomUUID()}.webp`;
  await putPublic(db, path, image);
  return { publicUrl: publicUrl(path), paths: [path] };
}

/** Column slot of a tenant-scoped table: compare-and-set on the previous URL. */
function columnSlot(table: string, column: string, labelColumn: string, folder: string, extraFilter?: (query: any) => any, revalidate?: DestinationImpl['revalidate']): DestinationImpl {
  return {
    async targets(db, tenant, q) {
      let query = db.from(table).select(`id, ${labelColumn}, ${column}`).eq('tenant_id', tenant.id);
      if (extraFilter) query = extraFilter(query);
      if (q) query = query.ilike(labelColumn, like(q));
      const { data } = await query.order(labelColumn, { ascending: true }).limit(30);
      return ((data ?? []) as unknown as Array<Record<string, string | null>>).map((row) => ({ id: row.id!, label: row[labelColumn] ?? '', imageUrl: row[column] ?? null }));
    },
    async target(db, tenant, targetId) {
      let query = db.from(table).select(`id, ${labelColumn}, ${column}`).eq('tenant_id', tenant.id).eq('id', targetId);
      if (extraFilter) query = extraFilter(query);
      const { data } = await query.maybeSingle();
      const row = data as Record<string, string | null> | null;
      return row ? { id: row.id!, label: row[labelColumn] ?? '', imageUrl: row[column] ?? null } : null;
    },
    store: (db, tenant, targetId, image) => storeSimple(db, tenant.id, folder, targetId, image),
    async attach(db, tenant, targetId, copy) {
      const current = await this.target(db, tenant, targetId);
      if (!current) return 'missing';
      let update = db.from(table).update({ [column]: copy.publicUrl }).eq('tenant_id', tenant.id).eq('id', targetId);
      update = current.imageUrl === null || current.imageUrl === undefined ? update.is(column, null) : update.eq(column, current.imageUrl);
      const { data, error } = await update.select('id');
      if (error) throw error;
      return (data ?? []).length === 1 ? 'ok' : 'conflict';
    },
    async detach(db, tenant, targetId, url) {
      const { data, error } = await db.from(table).update({ [column]: null }).eq('tenant_id', tenant.id).eq('id', targetId).eq(column, url).select('id');
      if (error) throw error;
      return (data ?? []).length === 1;
    },
    deleteCopy: true,
    revalidate: revalidate ?? (async () => undefined),
  };
}

const revalidateEvents: DestinationImpl['revalidate'] = async () => { try { revalidatePath('/evenementiel', 'layout'); } catch { /* outside a request */ } };

const product: DestinationImpl = {
  async targets(db, tenant, q) {
    let query = db.from('products').select('id, name, image_url, images, active').eq('tenant_id', tenant.id);
    if (q) query = query.ilike('name', like(q));
    const { data } = await query.order('name', { ascending: true }).limit(30);
    return ((data ?? []) as Array<{ id: string; name: string; image_url: string | null; images: unknown; active: boolean }>).map((row) => {
      const count = normalizeProductImages(row.images, row.image_url, row.name).length;
      return { id: row.id, label: row.name, imageUrl: row.image_url, detail: `${count}/${MAX_PRODUCT_IMAGES} images${row.active ? '' : ' · inactif'}` };
    });
  },
  async target(db, tenant, targetId) {
    const { data } = await db.from('products').select('id, name, image_url').eq('tenant_id', tenant.id).eq('id', targetId).maybeSingle();
    return data ? { id: data.id, label: data.name, imageUrl: data.image_url } : null;
  },
  async store(db, tenant, targetId, image) {
    const set = await uploadProductImageSet({
      supabase: db, bytes: image, mime: 'image/webp', tenantId: tenant.id, productId: targetId, baseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    });
    return { publicUrl: set.url, paths: set.paths };
  },
  async attach(db, tenant, targetId, copy, options) {
    const { data: row } = await db.from('products').select('name, image_url, images, updated_at').eq('tenant_id', tenant.id).eq('id', targetId).maybeSingle();
    if (!row) return 'missing';
    const current = normalizeProductImages(row.images, row.image_url, row.name);
    if (current.length >= MAX_PRODUCT_IMAGES) return 'full';
    const entry = { url: copy.publicUrl, alt: row.name };
    const images = normalizeProductImages(options.asCover ? [entry, ...current] : [...current, entry], null, row.name);
    const { data, error } = await db.from('products').update({ image_url: images[0]?.url ?? null, images })
      .eq('tenant_id', tenant.id).eq('id', targetId).eq('updated_at', row.updated_at).select('id');
    if (error) throw error;
    return (data ?? []).length === 1 ? 'ok' : 'conflict';
  },
  async detach(db, tenant, targetId, url) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: row } = await db.from('products').select('name, image_url, images, updated_at').eq('tenant_id', tenant.id).eq('id', targetId).maybeSingle();
      if (!row) return false;
      const current = normalizeProductImages(row.images, row.image_url, row.name);
      if (!current.some((image) => image.url === url)) return false;
      const images = current.filter((image) => image.url !== url);
      const { data, error } = await db.from('products').update({ image_url: images[0]?.url ?? null, images })
        .eq('tenant_id', tenant.id).eq('id', targetId).eq('updated_at', row.updated_at).select('id');
      if (error) throw error;
      if ((data ?? []).length === 1) return true;
    }
    throw new Error('studio_invalid_transition');
  },
  deleteCopy: false,
  async revalidate(db, tenant) { revalidateCatalogCache(tenant.id); },
};

const story: DestinationImpl = {
  async targets(_db, tenant) { return [{ id: SINGLETON_TARGET, label: 'Section « Notre origine »', imageUrl: tenant.story_image_url ?? null }]; },
  async target(db, tenant, targetId) {
    if (targetId !== SINGLETON_TARGET) return null;
    const { data } = await db.from('tenants').select('story_image_url').eq('id', tenant.id).maybeSingle();
    return { id: SINGLETON_TARGET, label: 'Section « Notre origine »', imageUrl: data?.story_image_url ?? null };
  },
  store: (db, tenant, _targetId, image) => storeSimple(db, tenant.id, 'story', SINGLETON_TARGET, image),
  async attach(db, tenant, targetId, copy) {
    const current = await this.target(db, tenant, targetId);
    if (!current) return 'missing';
    let update = db.from('tenants').update({ story_image_url: copy.publicUrl }).eq('id', tenant.id);
    update = current.imageUrl ? update.eq('story_image_url', current.imageUrl) : update.is('story_image_url', null);
    const { data, error } = await update.select('id');
    if (error) throw error;
    return (data ?? []).length === 1 ? 'ok' : 'conflict';
  },
  async detach(db, tenant, _targetId, url) {
    const { data, error } = await db.from('tenants').update({ story_image_url: null }).eq('id', tenant.id).eq('story_image_url', url).select('id');
    if (error) throw error;
    return (data ?? []).length === 1;
  },
  deleteCopy: true,
  async revalidate() { revalidateTenantCache(); },
};

const cardHero: DestinationImpl = {
  async targets(db, tenant) { return [await this.target(db, tenant, SINGLETON_TARGET) as DestinationTarget]; },
  async target(db, tenant, targetId) {
    if (targetId !== SINGLETON_TARGET) return null;
    const state = await readModuleConfig(db, digitalCardModule, tenant.id);
    const config = state.config as { hero_image_base?: string | null; hero_image_widths?: number[] | null; hero_image_url?: string | null };
    const base = config.hero_image_base;
    const width = config.hero_image_widths?.at(-1);
    return { id: SINGLETON_TARGET, label: 'Photo en tête de la carte', imageUrl: base && width ? `${base}-${width}.webp` : config.hero_image_url ?? null };
  },
  async store(db, tenant, _targetId, image) {
    const meta = await sharp(image).metadata();
    const stored = await storeHeroVariants(db, tenant.id, sharp(image), meta.width ?? 1200);
    return { publicUrl: `${stored.base}-${stored.widths.at(-1)}.webp`, paths: stored.paths, extra: { base: stored.base, widths: stored.widths, version: stored.version } };
  },
  async attach(db, tenant, targetId, copy) {
    const before = await this.target(db, tenant, targetId);
    if (!before) return 'missing';
    const extra = copy.extra as { base: string; widths: number[]; version: string };
    // The module config has no row version: re-read just before writing (best effort CAS).
    const again = await this.target(db, tenant, targetId);
    if (again?.imageUrl !== before.imageUrl) return 'conflict';
    await updateModuleConfig(db, digitalCardModule, tenant.id, { config: { hero_image_base: extra.base, hero_image_widths: extra.widths, hero_image_url: null } });
    await removeOldHeroVariants(db, tenant.id, `${extra.version}-`);
    return 'ok';
  },
  async detach(db, tenant, targetId, url) {
    const current = await this.target(db, tenant, targetId);
    if (current?.imageUrl !== url) return false;
    await updateModuleConfig(db, digitalCardModule, tenant.id, { config: { hero_image_base: null, hero_image_widths: null } });
    return true;
  },
  deleteCopy: true,
  async revalidate() { revalidateTenantCache(); },
};

const eventGallery: DestinationImpl = {
  async targets() { return [{ id: SINGLETON_TARGET, label: 'Galerie photo de l’Événementiel' }]; },
  async target(_db, _tenant, targetId) { return targetId === SINGLETON_TARGET ? { id: SINGLETON_TARGET, label: 'Galerie photo de l’Événementiel' } : null; },
  store: (db, tenant, _targetId, image) => storeSimple(db, tenant.id, 'events-gallery', SINGLETON_TARGET, image),
  async attach(db, tenant, _targetId, copy) {
    const { data: last } = await db.from('event_gallery_photos').select('sort_order').eq('tenant_id', tenant.id)
      .order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const { error } = await db.from('event_gallery_photos').insert({ tenant_id: tenant.id, image_url: copy.publicUrl, sort_order: (last?.sort_order ?? -1) + 1 });
    if (error) throw error;
    return 'ok';
  },
  async detach(db, tenant, _targetId, url) {
    const { data, error } = await db.from('event_gallery_photos').delete().eq('tenant_id', tenant.id).eq('image_url', url).select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  },
  deleteCopy: true,
  revalidate: revalidateEvents,
};

export const STUDIO_DESTINATION_IMPLS: Record<StudioDestinationKey, DestinationImpl> = {
  product,
  hero_slide: columnSlot('tenant_hero_slides', 'image_url', 'title', 'hero-slides', undefined, async (_db, tenant) => revalidateCatalogCache(tenant.id)),
  category: columnSlot('categories', 'image_url', 'name', 'categories', undefined, async (_db, tenant) => revalidateCatalogCache(tenant.id)),
  story,
  card_hero: cardHero,
  event_banner: columnSlot('events', 'banner_image_url', 'title', 'events', (query) => query.neq('status', 'cancelled'), revalidateEvents),
  service_cover: columnSlot('service_offerings', 'cover_image_url', 'title', 'services', undefined, revalidateEvents),
  rental_item: columnSlot('rental_items', 'image_url', 'name', 'rental-items', undefined, revalidateEvents),
  event_gallery: eventGallery,
};

/** A public copy exists with the expected bytes count (copy → verify). */
export async function verifyPublicCopy(db: SupabaseClient, paths: string[]): Promise<boolean> {
  for (const path of paths.slice(0, 12)) {
    const slash = path.lastIndexOf('/');
    // Card hero variants live in the same public bucket (CARD_HERO_BUCKET = assets).
    const { data, error } = await db.storage.from(STUDIO_PUBLIC_BUCKET)
      .list(path.slice(0, slash), { limit: 100, search: path.slice(slash + 1) });
    if (error || !(data ?? []).some((file) => file.name === path.slice(slash + 1))) return false;
  }
  return true;
}

export async function removePublic(db: SupabaseClient, paths: string[]): Promise<void> {
  if (paths.length) await db.storage.from(STUDIO_PUBLIC_BUCKET).remove(paths);
}
