/**
 * Dry run by default. Example:
 * pnpm --filter @lepefy/storefront images:backfill --tenant chloefood --limit 20
 * Add --apply only after an approved production window; --apply requires --backup <path>.
 * --include-unscoped also converts same-project legacy URLs outside tenants/{tenantId}/products/{productId}/.
 */
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { normalizeProductImages } from '../src/lib/catalog/productImages';
import { parseManagedProductImage } from '../src/lib/images/productImageDelivery';
import { productImageIdForLegacyUrl, uploadProductImageSet } from '../src/lib/images/productImagePipeline';

const args = process.argv.slice(2);
function option(name: string) {
  const index = args.indexOf('--' + name);
  return index >= 0 ? args[index + 1] : undefined;
}
function numberOption(name: string, fallback: number, max: number) {
  const raw = option(name);
  const value = raw == null ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Invalid --' + name);
  return value;
}

const tenantKey = option('tenant');
if (!tenantKey) throw new Error('--tenant <slug-or-uuid> is required');
const apply = args.includes('--apply');
const validate = args.includes('--validate');
const limit = numberOption('limit', 100_000, 100_000);
const concurrency = numberOption('concurrency', 2, 8);
const rateMs = numberOption('rate-ms', 250, 60_000);
const productFilter = option('product');
const reportPath = option('report');
const backupPath = option('backup');
const includeUnscoped = args.includes('--include-unscoped');
if (apply && !backupPath) throw new Error('--apply requires --backup <path> for the original image_url/images rows');
const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error('Supabase URL and service role env are required');
const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

const tenantQuery = db.from('tenants').select('id, slug').limit(1);
const { data: tenant, error: tenantError } = await (
  /^[0-9a-f-]{36}$/i.test(tenantKey) ? tenantQuery.eq('id', tenantKey) : tenantQuery.eq('slug', tenantKey)
).single();
if (tenantError || !tenant) throw new Error('Tenant not found');
const tenantId = tenant.id;

type ProductRow = { id: string; name: string; image_url: string | null; images: unknown; updated_at: string };
const rows: ProductRow[] = [];
for (let offset = 0; rows.length < limit; offset += 200) {
  let query = db.from('products').select('id, name, image_url, images, updated_at').eq('tenant_id', tenantId).order('id').range(offset, offset + Math.min(199, limit - rows.length - 1));
  if (productFilter) query = query.eq('id', productFilter);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  rows.push(...(data ?? []));
  if (!data || data.length < Math.min(200, limit - rows.length + data.length)) break;
}

// Written before any Storage or DB write, so every applied product can be restored.
if (apply && backupPath) {
  await writeFile(backupPath, JSON.stringify({ tenantId, createdAt: new Date().toISOString(), products: rows }, null, 2) + '\n', { flag: 'wx' });
}

const results: Array<Record<string, unknown>> = [];
let cursor = 0;
async function processProduct(product: ProductRow) {
  const images = normalizeProductImages(product.images, product.image_url, product.name);
  let migrated = 0;
  let legacy = 0;
  let external = 0;
  let unscoped = 0;
  let validated = 0;
  let sourceBytes = 0;
  let storedBytes = 0;
  const replacements = new Map<string, string>();
  const imageResults: Array<{ index: number; status: string; sourceBytes?: number; storedBytes?: number; width?: number; height?: number; format?: string }> = [];
  for (const [index, image] of images.entries()) {
    if (parseManagedProductImage(image.url, baseUrl, tenantId)) {
      migrated++;
      imageResults.push({ index, status: 'migrated' });
      continue;
    }
    let path: string;
    try {
      const url = new URL(image.url);
      const source = new URL(baseUrl!);
      const bucketPrefix = '/storage/v1/object/public/assets/';
      const prefix = `${bucketPrefix}tenants/${tenantId}/products/${product.id}/`;
      if (url.origin !== source.origin || url.username || url.password || !url.pathname.startsWith(bucketPrefix)) {
        external++; imageResults.push({ index, status: 'external' }); continue;
      }
      path = decodeURIComponent(url.pathname.slice(bucketPrefix.length));
      if (path.includes('..') || path.includes('\\') || path.includes('%') || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path)) {
        external++; imageResults.push({ index, status: 'unrecognized' }); continue;
      }
      // Older uploads live outside the tenant/product prefix: same project, but not tenant-scoped by path.
      if (!url.pathname.startsWith(prefix)) {
        unscoped++;
        if (!includeUnscoped) { imageResults.push({ index, status: 'legacy-unscoped' }); continue; }
      }
    } catch { external++; imageResults.push({ index, status: 'unrecognized' }); continue; }
    legacy++;
    if (!apply && !validate) { imageResults.push({ index, status: 'legacy' }); continue; }
    const { data: blob, error: downloadError } = await db.storage.from('assets').download(path);
    if (downloadError || !blob) throw new Error('Download failed for a managed image');
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (validate && !apply) {
      const metadata = await sharp(bytes, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
      if (!metadata.width || !metadata.height || metadata.pages && metadata.pages > 1 || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '')) {
        throw new Error('Unsupported image in sample');
      }
      validated++;
      sourceBytes += bytes.length;
      imageResults.push({ index, status: 'validated', sourceBytes: bytes.length, width: metadata.width, height: metadata.height, format: metadata.format });
      continue;
    }
    const extension = path.toLowerCase().split('.').pop();
    const mime = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
    const set = await uploadProductImageSet({
      supabase: db, bytes, mime, tenantId, productId: product.id,
      baseUrl: baseUrl!, imageId: productImageIdForLegacyUrl(image.url), allowExisting: true,
    });
    replacements.set(image.url, set.url);
    sourceBytes += set.sourceBytes;
    storedBytes += set.storedBytes;
    imageResults.push({ index, status: 'converted', sourceBytes: set.sourceBytes, storedBytes: set.storedBytes });
    await new Promise((resolve) => setTimeout(resolve, rateMs));
  }
  if (replacements.size) {
    const { data: current, error: readError } = await db.from('products').select('image_url, images, updated_at').eq('tenant_id', tenantId).eq('id', product.id).single();
    if (readError || !current || JSON.stringify(current.images) !== JSON.stringify(product.images) || current.image_url !== product.image_url || current.updated_at !== product.updated_at) {
      throw new Error('Gallery changed during backfill; retry after review');
    }
    const updatedImages = Array.isArray(product.images)
      ? product.images.map((entry) => {
          if (!entry || typeof entry !== 'object') return entry;
          const value = entry as Record<string, unknown>;
          return typeof value.url === 'string' && replacements.has(value.url)
            ? { ...value, url: replacements.get(value.url) }
            : entry;
        })
      : product.images;
    const { data: written, error: updateError } = await db.from('products')
      .update({ image_url: product.image_url ? replacements.get(product.image_url) ?? product.image_url : null, images: updatedImages })
      .eq('tenant_id', tenantId).eq('id', product.id).eq('updated_at', product.updated_at)
      .select('id');
    if (updateError || !written?.length) throw new Error(updateError?.message ?? 'Concurrent product update');
  }
  return { productId: product.id, imageCount: images.length, imageResults, migrated, legacy, unscoped, external, validated, converted: replacements.size, sourceBytes, storedBytes, status: 'ok' };
}

async function worker() {
  while (cursor < rows.length) {
    const product = rows[cursor++]!;
    try {
      const result = await processProduct(product);
      results.push(result);
      console.info(JSON.stringify(result));
    } catch (error) {
      const result = { productId: product.id, status: 'error', reason: error instanceof Error ? error.message : String(error) };
      results.push(result);
      console.error(JSON.stringify(result));
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const summary = {
  tenantId,
  mode: apply ? 'apply' : 'dry-run',
  products: rows.length,
  errors: results.filter((item) => item.status === 'error').length,
  migrated: results.reduce((sum, item) => sum + Number(item.migrated ?? 0), 0),
  legacy: results.reduce((sum, item) => sum + Number(item.legacy ?? 0), 0),
  unscoped: results.reduce((sum, item) => sum + Number(item.unscoped ?? 0), 0),
  external: results.reduce((sum, item) => sum + Number(item.external ?? 0), 0),
  converted: results.reduce((sum, item) => sum + Number(item.converted ?? 0), 0),
  validated: results.reduce((sum, item) => sum + Number(item.validated ?? 0), 0),
  sourceBytes: results.reduce((sum, item) => sum + Number(item.sourceBytes ?? 0), 0),
  storedBytes: results.reduce((sum, item) => sum + Number(item.storedBytes ?? 0), 0),
};
console.info(JSON.stringify({ summary }));
if (reportPath) await writeFile(reportPath, JSON.stringify({ summary, results }, null, 2) + '\n');
if (summary.errors) process.exitCode = 1;
