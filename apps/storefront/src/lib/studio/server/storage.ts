import 'server-only';
import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { STUDIO_LIMITS, STUDIO_PRIVATE_BUCKET, type StudioImageMime } from '../domain';

/**
 * Private files of the Studio, bucket `studio-private` (no storage policy):
 *   tenants/<tenant>/uploads/<admin>/<uuid>      raw upload from the phone (signed URL)
 *   tenants/<tenant>/assets/<key>/source.jpg     normalised original
 *   tenants/<tenant>/assets/<key>/rev-<n>.webp   each proposal
 * Nothing here is public: the browser reads through 5-minute signed URLs.
 */

export const uploadPrefix = (tenantId: string, adminId: string) => `tenants/${tenantId}/uploads/${adminId}/`;
export const assetPrefix = (tenantId: string, key: string) => `tenants/${tenantId}/assets/${key}/`;

export async function createSignedUpload(db: SupabaseClient, tenantId: string, adminId: string): Promise<{ path: string; token: string }> {
  const path = uploadPrefix(tenantId, adminId) + randomUUID();
  const { data, error } = await db.storage.from(STUDIO_PRIVATE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error('signed_upload_failed');
  return { path, token: data.token };
}

export interface NormalizedImage {
  bytes: Buffer;
  mime: StudioImageMime;
  width: number;
  height: number;
  sha256: string;
}

/** Decodes untrusted bytes: type from the content, EXIF rotation, at most 2048 px. */
export async function normalizeImage(input: Buffer, format: 'jpeg' | 'webp'): Promise<NormalizedImage> {
  const image = sharp(input, { failOn: 'error', limitInputPixels: STUDIO_LIMITS.maxInputPixels });
  const meta = await image.metadata();
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format) || (meta.pages ?? 1) > 1) throw new Error('unsupported_image');
  const pipeline = image.rotate()
    .resize(STUDIO_LIMITS.maxStoredEdge, STUDIO_LIMITS.maxStoredEdge, { fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb');
  const { data, info } = format === 'jpeg'
    ? await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    : await pipeline.webp({ quality: 90, effort: 4 }).toBuffer({ resolveWithObject: true });
  return {
    bytes: data,
    mime: format === 'jpeg' ? 'image/jpeg' : 'image/webp',
    width: info.width,
    height: info.height,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

/**
 * Takes the raw upload of this admin, checks it, stores the normalised
 * original under the asset key and deletes the raw upload.
 */
export async function adoptUpload(
  db: SupabaseClient,
  input: { tenantId: string; adminId: string; uploadPath: string; key: string },
): Promise<{ path: string } & NormalizedImage> {
  if (!input.uploadPath.startsWith(uploadPrefix(input.tenantId, input.adminId)) || input.uploadPath.includes('..')) {
    throw new Error('upload_not_found');
  }
  const bucket = db.storage.from(STUDIO_PRIVATE_BUCKET);
  const { data, error } = await bucket.download(input.uploadPath);
  if (error || !data) throw new Error('upload_not_found');
  if (data.size > STUDIO_LIMITS.uploadBytes) throw new Error('upload_too_large');
  let normalized: NormalizedImage;
  try {
    normalized = await normalizeImage(Buffer.from(await data.arrayBuffer()), 'jpeg');
  } catch {
    await bucket.remove([input.uploadPath]);
    throw new Error('unsupported_image');
  }
  if (Math.min(normalized.width, normalized.height) < STUDIO_LIMITS.minSourceEdge) {
    await bucket.remove([input.uploadPath]);
    throw new Error('image_too_small');
  }
  const path = assetPrefix(input.tenantId, input.key) + 'source.jpg';
  const { error: uploadError } = await bucket.upload(path, normalized.bytes, { contentType: 'image/jpeg', upsert: true, cacheControl: '3600' });
  if (uploadError) throw new Error('store_failed');
  await bucket.remove([input.uploadPath]);
  return { path, ...normalized };
}

export async function downloadPrivate(db: SupabaseClient, path: string): Promise<Buffer> {
  const { data, error } = await db.storage.from(STUDIO_PRIVATE_BUCKET).download(path);
  if (error || !data) throw new Error('source_missing');
  return Buffer.from(await data.arrayBuffer());
}

export async function uploadPrivate(db: SupabaseClient, path: string, bytes: Buffer, contentType: string): Promise<void> {
  const { error } = await db.storage.from(STUDIO_PRIVATE_BUCKET).upload(path, bytes, { contentType, upsert: true, cacheControl: '3600' });
  if (error) throw new Error('store_failed');
}

/** Signed read URLs of several private files in one call (missing ones are absent). */
export async function signedUrls(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  const result = new Map<string, string>();
  if (unique.length === 0) return result;
  const { data } = await db.storage.from(STUDIO_PRIVATE_BUCKET).createSignedUrls(unique, STUDIO_LIMITS.signedReadSeconds);
  for (const row of data ?? []) if (row.path && row.signedUrl && !row.error) result.set(row.path, row.signedUrl);
  return result;
}

export async function removePrivate(db: SupabaseClient, paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  if (list.length === 0) return;
  const { error } = await db.storage.from(STUDIO_PRIVATE_BUCKET).remove(list);
  if (error) throw new Error('remove_failed');
}

/** Raw uploads never adopted (page closed before « Créer ») older than one day. */
export async function removeStaleUploads(db: SupabaseClient, tenantId: string, now = Date.now()): Promise<number> {
  const bucket = db.storage.from(STUDIO_PRIVATE_BUCKET);
  const { data: admins } = await bucket.list(`tenants/${tenantId}/uploads`, { limit: 100 });
  let removed = 0;
  for (const admin of admins ?? []) {
    const folder = `tenants/${tenantId}/uploads/${admin.name}`;
    const { data: files } = await bucket.list(folder, { limit: 100 });
    const stale = (files ?? []).filter((file) => file.created_at && now - Date.parse(file.created_at) > 24 * 3600_000).map((file) => `${folder}/${file.name}`);
    if (stale.length) { await bucket.remove(stale); removed += stale.length; }
  }
  return removed;
}
