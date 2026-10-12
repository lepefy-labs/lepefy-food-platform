import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PRODUCT_IMAGE_WEBP_QUALITY_V3, PRODUCT_IMAGE_WIDTHS_V3 } from './productImageDelivery';

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface ProductImageSet {
  url: string;
  paths: string[];
  sourceBytes: number;
  storedBytes: number;
  hash: string;
  width: number;
  height: number;
}

export function productImageIdForLegacyUrl(url: string) {
  return createHash('sha256').update(url).digest('hex').slice(0, 32);
}

export async function uploadProductImageSet(input: {
  supabase: SupabaseClient;
  bytes: Buffer;
  mime: string;
  tenantId: string;
  productId: string;
  baseUrl: string;
  imageId?: string;
  allowExisting?: boolean;
  /** Bytes are already a pipeline master (rotated, at most 1600 px): store them unchanged. */
  reuseMaster?: boolean;
}): Promise<ProductImageSet> {
  const { supabase, bytes, mime, tenantId, productId, baseUrl } = input;
  if (!MIME_EXTENSION[mime]) throw new Error('Unsupported product image format');
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(productId)) throw new Error('Invalid tenant/product identifier');
  const imageId = input.imageId ?? randomUUID();
  if (!/^[0-9a-f-]{32,36}$/i.test(imageId)) throw new Error('Invalid image identifier');
  const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) throw new Error('Unsupported or animated product image');
  const actualMime = metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`;
  const extension = MIME_EXTENSION[actualMime];
  if (!extension) throw new Error('Unsupported product image content');
  const prefix = `tenants/${tenantId}/products/${productId}/${imageId}/v3/`;
  const masterFormat = (extension === 'jpg' ? 'jpeg' : extension) as 'jpeg' | 'png' | 'webp';
  if (input.reuseMaster && (metadata.width > 1600 || metadata.height > 1600 || (metadata.orientation ?? 1) !== 1)) {
    throw new Error('Reused master must be upright and at most 1600 px');
  }
  const master = input.reuseMaster
    ? bytes
    : await sharp(bytes).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).toFormat(masterFormat).toBuffer();
  const masterMeta = await sharp(master).metadata();
  const variants = await Promise.all(
    PRODUCT_IMAGE_WIDTHS_V3.map(async (size) => ({
      path: prefix + 'w' + size + '.webp',
      bytes: await sharp(bytes).rotate().resize(size, size, { fit: 'inside', withoutEnlargement: true }).webp({ quality: PRODUCT_IMAGE_WEBP_QUALITY_V3, effort: 4 }).toBuffer(),
      contentType: 'image/webp',
    })),
  );
  const objects = [
    { path: prefix + 'master.' + extension, bytes: master, contentType: actualMime },
    ...variants,
  ];
  const uploaded: string[] = [];
  try {
    for (const object of objects) {
      const { error } = await supabase.storage.from('assets').upload(object.path, object.bytes, {
        contentType: object.contentType,
        cacheControl: '31536000',
        upsert: false,
      });
      if (error) {
        if (!input.allowExisting || !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
        const { data, error: downloadError } = await supabase.storage.from('assets').download(object.path);
        if (downloadError || !data || Buffer.compare(Buffer.from(await data.arrayBuffer()), object.bytes) !== 0) {
          throw new Error('Existing image variant differs: ' + object.path);
        }
      } else uploaded.push(object.path);
    }
  } catch (error) {
    if (uploaded.length) await supabase.storage.from('assets').remove(uploaded);
    throw error;
  }
  const canonicalBase = baseUrl.replace(/\/$/, '');
  return {
    url: `${canonicalBase}/storage/v1/object/public/assets/${objects[0]!.path}`,
    paths: objects.map((object) => object.path),
    sourceBytes: bytes.length,
    storedBytes: objects.reduce((sum, object) => sum + object.bytes.length, 0),
    hash: createHash('sha256').update(bytes).digest('hex'),
    width: masterMeta.width!,
    height: masterMeta.height!,
  };
}
