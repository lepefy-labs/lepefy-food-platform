import 'server-only';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/server';
import { isFeatureEnabled } from '@/lib/featureFlags/featureFlags';
import { revalidateCatalogCache } from '@/lib/cache/storefrontCache';
import { syncProductEmbedding } from '@/lib/ai/embeddings';
import { assignBarcodeToProduct } from '@/lib/barcode';
import { MAX_PRODUCT_IMAGES } from '@/lib/catalog/productImages';
import { createImageStager, DEFAULT_IMAGE_HOST_SUFFIXES } from '../imageStaging';
import { normalizeExternalProduct } from '../normalizeProduct';
import { externalContentHash } from '../contentHash';
import { getExternalCatalogProvider } from '../providers';
import { GREEN_API_MAX_PRODUCT_LIMIT } from '../providers/greenApi';
import { sellerChatIdFromPhone } from '../sellerPhone';
import { parseWhatsAppCatalogUrl } from '../sourceUrl';
import { ExternalCatalogError } from '../types';
import type { NormalizedExternalProduct, RawExternalProduct } from '../types';
import { externalCatalogRpcError, PROVIDER_ERROR_MESSAGES } from './errors';

/**
 * Accesso dati della console platform "Catalogues WhatsApp" (migration 149).
 * Ogni funzione è chiamata da route già protette da `requirePlatformOwner`;
 * le scritture sui prodotti di un tenant passano SOLO dalle RPC 149 e solo se
 * il tenant ha il flag `external_catalog_import`.
 */

export const EXTERNAL_CATALOG_FLAG = 'external_catalog_import';
const ITEM_STATUSES = ['new', 'changed', 'linked', 'dismissed', 'unavailable'] as const;
export type ExternalItemStatus = (typeof ITEM_STATUSES)[number];

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; code?: string };

function fail(status: number, error: string, code?: string): { ok: false; status: number; error: string; code?: string } {
  return { ok: false, status, error, code };
}

function fromDbError(error: { message?: string | null; code?: string | null }) {
  const info = externalCatalogRpcError(error);
  if (info.status >= 500) console.error('[external-catalog] db error', error.code, error.message);
  return fail(info.status, info.message, info.code);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceClient();
}

async function requireTenantFlag(tenantId: string) {
  if (await isFeatureEnabled(tenantId, EXTERNAL_CATALOG_FLAG)) return null;
  return fail(403, 'Import désactivé pour ce tenant : activez la fonctionnalité « Import de catalogues WhatsApp » (external_catalog_import).', 'flag_disabled');
}

// ─── Tenants e sorgenti ─────────────────────────────────────────────────────

export interface TenantOption {
  id: string;
  slug: string;
  name: string;
  flag_enabled: boolean;
}

export async function listTenantOptions(): Promise<TenantOption[]> {
  const { data } = await db().from('tenants').select('id, slug, name').order('name');
  const tenants = (data ?? []) as Array<{ id: string; slug: string; name: string }>;
  const flags = await Promise.all(tenants.map((t) => isFeatureEnabled(t.id, EXTERNAL_CATALOG_FLAG)));
  return tenants.map((t, i) => ({ ...t, flag_enabled: Boolean(flags[i]) }));
}

export async function listSources(): Promise<ServiceResult<unknown[]>> {
  const { data, error } = await db()
    .from('external_catalog_sources')
    .select('id, tenant_id, provider, label, source_url, seller_chat_id, default_discount_pct, consent_status, consent_recorded_at, status, last_fetched_at, last_fetch_status, last_fetch_error, last_fetch_truncated, created_at, tenants(slug, name)')
    .order('created_at', { ascending: false });
  if (error) return fromDbError(error);
  const ids = (data ?? []).map((s: { id: string }) => s.id);
  const counts: Record<string, Record<string, number>> = {};
  if (ids.length) {
    const { data: items, error: itemsError } = await db().from('external_catalog_items').select('source_id, status').in('source_id', ids);
    if (itemsError) return fromDbError(itemsError);
    for (const it of (items ?? []) as Array<{ source_id: string; status: string }>) {
      counts[it.source_id] ??= {};
      const bucket = counts[it.source_id] as Record<string, number>;
      bucket[it.status] = (bucket[it.status] ?? 0) + 1;
    }
  }
  return { ok: true, data: (data ?? []).map((s: { id: string }) => ({ ...s, counts: counts[s.id] ?? {} })) };
}

export async function createSource(input: {
  tenantId: string; label: string; url: string; sellerPhone: string; discountPct: number;
}, actor: string | null): Promise<ServiceResult<{ id: string }>> {
  const chatId = sellerChatIdFromPhone(input.sellerPhone);
  if (!chatId) return fail(400, 'Numéro WhatsApp du vendeur invalide (format international, ex. +39 329 695 8822).');
  let source;
  try {
    source = parseWhatsAppCatalogUrl(input.url, chatId);
  } catch {
    return fail(400, 'Lien de catalogue invalide (attendu : https://wa.me/c/…).');
  }
  const { data: tenant } = await db().from('tenants').select('id').eq('id', input.tenantId).maybeSingle();
  if (!tenant) return fail(404, 'Tenant introuvable.');
  const { data, error } = await db().from('external_catalog_sources').insert({
    tenant_id: input.tenantId,
    label: input.label.trim(),
    source_url: source.url,
    seller_chat_id: source.chatId,
    default_discount_pct: input.discountPct,
    created_by: actor,
  }).select('id').single();
  if (error) return fromDbError(error);
  return { ok: true, data: { id: data.id as string } };
}

export async function updateSource(id: string, patch: {
  label?: string; discountPct?: number; consentStatus?: 'missing' | 'granted' | 'revoked'; consentNote?: string | null; status?: 'active' | 'archived';
}, actor: string | null): Promise<ServiceResult<null>> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) update.label = patch.label.trim();
  if (patch.discountPct !== undefined) update.default_discount_pct = patch.discountPct;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.consentStatus !== undefined) {
    update.consent_status = patch.consentStatus;
    update.consent_note = patch.consentNote ?? null;
    update.consent_recorded_at = patch.consentStatus === 'missing' ? null : new Date().toISOString();
    update.consent_recorded_by = patch.consentStatus === 'missing' ? null : actor;
  }
  const { data, error } = await db().from('external_catalog_sources').update(update).eq('id', id).select('id').maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail(404, 'Source introuvable.');
  return { ok: true, data: null };
}

async function loadSource(id: string) {
  const { data, error } = await db()
    .from('external_catalog_sources')
    .select('*, tenants(slug, name, storefront_url)')
    .eq('id', id)
    .maybeSingle();
  if (error) return fromDbError(error);
  if (!data) return fail(404, 'Source introuvable.');
  return { ok: true as const, data };
}

// ─── Lettura dal provider ───────────────────────────────────────────────────

export async function refreshSource(id: string, actor: string | null): Promise<ServiceResult<Record<string, number | boolean>>> {
  const loaded = await loadSource(id);
  if (!loaded.ok) return loaded;
  const source = loaded.data;
  const denied = await requireTenantFlag(source.tenant_id);
  if (denied) return denied;
  if (source.status !== 'active') return fail(409, 'Cette source est archivée.');

  const fetchedAt = new Date().toISOString();
  let products: RawExternalProduct[];
  let truncated: boolean;
  let provider: 'green_api';
  try {
    const parsed = parseWhatsAppCatalogUrl(source.source_url, source.seller_chat_id);
    const result = await getExternalCatalogProvider(process.env).fetchProducts(parsed, { limit: GREEN_API_MAX_PRODUCT_LIMIT, timeoutMs: 25_000, maxRetries: 1 });
    products = result.products;
    truncated = result.truncated;
    provider = result.provider;
  } catch (err) {
    const code = err instanceof ExternalCatalogError ? err.code : 'PROVIDER_ERROR';
    const message = PROVIDER_ERROR_MESSAGES[code] ?? PROVIDER_ERROR_MESSAGES.PROVIDER_ERROR ?? 'Erreur du fournisseur.';
    console.error('[external-catalog] refresh failed', id, code);
    await db().from('external_catalog_sources').update({
      last_fetched_at: fetchedAt, last_fetch_status: 'failed', last_fetch_error: message.slice(0, 500), updated_at: fetchedAt,
    }).eq('id', id);
    return fail(code === 'RATE_LIMITED' ? 429 : 502, message, code);
  }

  const items = products.map((raw) => {
    const normalized = normalizeExternalProduct(raw, { provider, catalogId: source.source_url.split('/').pop() ?? '', rawFile: 'external_catalog_items.raw' });
    return {
      provider_product_id: raw.providerProductId,
      raw,
      normalized,
      content_hash: externalContentHash(raw),
      displayed_price: normalized.displayed_price?.toFixed(2) ?? null,
      sale_price: normalized.sale_price?.toFixed(2) ?? null,
      currency: normalized.currency,
    };
  });
  const { data, error } = await db().rpc('external_catalog_record_fetch', {
    p_tenant_id: source.tenant_id, p_source_id: id, p_items: items, p_fetched_at: fetchedAt, p_truncated: truncated, p_actor: actor,
  });
  if (error) return fromDbError(error);
  const row = (Array.isArray(data) ? data[0] : data) as { out_new: number; out_changed: number; out_unchanged: number; out_unavailable: number };
  return {
    ok: true,
    data: { received: items.length, new: row.out_new, changed: row.out_changed, unchanged: row.out_unchanged, unavailable: row.out_unavailable, truncated },
  };
}

// ─── Lettura per la UI ──────────────────────────────────────────────────────

export async function getSourceWithItems(id: string, status: string | null): Promise<ServiceResult<{ source: unknown; items: unknown[] }>> {
  const loaded = await loadSource(id);
  if (!loaded.ok) return loaded;
  let query = db()
    .from('external_catalog_items')
    .select('id, provider_product_id, normalized, displayed_price, sale_price, currency, previous_price, price_changed_at, status, linked_product_id, applied_at, last_seen_at, products(id, name, price, active)')
    .eq('source_id', id)
    .order('first_seen_at', { ascending: true });
  if (status && (ITEM_STATUSES as readonly string[]).includes(status)) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return fromDbError(error);
  return { ok: true, data: { source: loaded.data, items: data ?? [] } };
}

export async function getItemDetail(itemId: string): Promise<ServiceResult<unknown>> {
  const { data: item, error } = await db()
    .from('external_catalog_items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle();
  if (error) return fromDbError(error);
  if (!item) return fail(404, 'Produit WhatsApp introuvable.');
  const loaded = await loadSource(item.source_id);
  if (!loaded.ok) return loaded;
  const tenantId = item.tenant_id as string;
  const [categories, product, events, flag] = await Promise.all([
    db().from('categories').select('id, name').eq('tenant_id', tenantId).order('name'),
    item.linked_product_id
      ? db().from('products').select('id, name, description, price, min_order_quantity, order_quantity_step, weight_grams, net_quantity_display, category_id, active, image_url, images, slug').eq('id', item.linked_product_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    db().from('external_catalog_events').select('action, fields, created_at, product_id').eq('item_id', itemId).order('created_at', { ascending: false }).limit(20),
    isFeatureEnabled(tenantId, EXTERNAL_CATALOG_FLAG),
  ]);
  return {
    ok: true,
    data: {
      item,
      source: loaded.data,
      categories: categories.data ?? [],
      product: product.data ?? null,
      events: events.data ?? [],
      flagEnabled: flag,
    },
  };
}

export async function searchTenantProducts(tenantId: string, q: string): Promise<ServiceResult<unknown[]>> {
  const safe = q.replace(/[%_,()]/g, ' ').trim().slice(0, 80);
  let query = db().from('products').select('id, name, price, min_order_quantity, active, image_url').eq('tenant_id', tenantId).order('name').limit(20);
  if (safe) query = query.ilike('name', `%${safe}%`);
  const { data, error } = await query;
  if (error) return fromDbError(error);
  return { ok: true, data: data ?? [] };
}

// ─── Applicazione ───────────────────────────────────────────────────────────

export interface ApplyInput {
  mode: 'create' | 'update';
  productId: string | null;
  fields: Record<string, string | number | null>;
  images: boolean;
  requestKey: string;
}

export interface ApplyOutcome {
  productId: string;
  created: boolean;
  replayed: boolean;
  images: { attached: number; failed: Array<{ url: string; reason: string }> };
}

function publicAssetUrl(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/assets/${path}`;
}

async function copyImages(tenantId: string, productId: string, normalized: NormalizedExternalProduct, productName: string) {
  const captured = new Map<string, Uint8Array>();
  const allowed = process.env.WHATSAPP_CATALOG_IMAGE_HOSTS?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_IMAGE_HOST_SUFFIXES;
  const stager = createImageStager({ writeFile: async (rel, bytes) => { captured.set(rel, bytes); } }, { allowedHostSuffixes: allowed, timeoutMs: 15_000 });
  const uploaded: Array<{ url: string; alt: string }> = [];
  const failed: Array<{ url: string; reason: string }> = [];

  for (const image of normalized.images.slice(0, MAX_PRODUCT_IMAGES)) {
    let staged = await stager.stage(image.original_url ?? image.url);
    if (!staged.file && image.preview_url && image.preview_url !== image.original_url) {
      staged = await stager.stage(image.preview_url);
    }
    const bytes = staged.file ? captured.get(staged.file) : undefined;
    if (!staged.file || !bytes || !staged.sha256) {
      if (staged.status !== 'duplicate') failed.push({ url: image.url, reason: staged.detail ?? staged.status });
      continue;
    }
    const resized = await sharp(bytes).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).toBuffer();
    const ext = staged.file.split('.').pop() ?? 'jpg';
    const path = `tenants/${tenantId}/products/${productId}/wa-${staged.sha256.slice(0, 32)}.${ext}`;
    const { error } = await createServiceClient().storage.from('assets').upload(path, resized, { contentType: staged.mime ?? 'image/jpeg', upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) {
      failed.push({ url: image.url, reason: 'Échec du téléversement vers le stockage.' });
      continue;
    }
    uploaded.push({ url: publicAssetUrl(path), alt: productName });
  }
  return { uploaded, failed };
}

export async function applyItem(itemId: string, input: ApplyInput, actor: string | null): Promise<ServiceResult<ApplyOutcome>> {
  const { data: item, error } = await db().from('external_catalog_items').select('id, tenant_id, normalized').eq('id', itemId).maybeSingle();
  if (error) return fromDbError(error);
  if (!item) return fail(404, 'Produit WhatsApp introuvable.');
  const tenantId = item.tenant_id as string;
  const denied = await requireTenantFlag(tenantId);
  if (denied) return denied;

  const { data, error: rpcError } = await db().rpc('external_catalog_apply_item', {
    p_tenant_id: tenantId,
    p_item_id: itemId,
    p_mode: input.mode,
    p_product_id: input.productId,
    p_fields: input.fields,
    p_request_key: input.requestKey,
    p_actor: actor,
  });
  if (rpcError) return fromDbError(rpcError);
  const row = (Array.isArray(data) ? data[0] : data) as { out_product_id: string; out_created: boolean; out_replayed: boolean };
  const outcome: ApplyOutcome = { productId: row.out_product_id, created: row.out_created, replayed: row.out_replayed, images: { attached: 0, failed: [] } };

  if (input.images && !row.out_replayed) {
    const normalized = item.normalized as NormalizedExternalProduct;
    const name = typeof input.fields.name === 'string' ? input.fields.name : normalized.normalized_name ?? 'Produit';
    const { uploaded, failed } = await copyImages(tenantId, row.out_product_id, normalized, name);
    outcome.images.failed = failed;
    if (uploaded.length) {
      const { error: imgError } = await db().rpc('external_catalog_attach_images', {
        p_tenant_id: tenantId, p_item_id: itemId, p_product_id: row.out_product_id, p_images: uploaded,
        p_request_key: `${input.requestKey}:images`, p_actor: actor,
      });
      if (imgError) {
        console.error('[external-catalog] attach images failed', imgError.message);
        outcome.images.failed.push({ url: '', reason: externalCatalogRpcError(imgError).message });
      } else {
        outcome.images.attached = uploaded.length;
      }
    }
  }

  if (row.out_created && !row.out_replayed) {
    try {
      await assignBarcodeToProduct(createServiceClient(), tenantId, row.out_product_id);
    } catch (barcodeError) {
      console.error('[external-catalog] barcode', barcodeError);
    }
  }
  if (!row.out_replayed) {
    await syncProductEmbedding(tenantId, row.out_product_id);
    // Invalida la cache di QUESTO deployment; lo storefront del tenant (altro
    // progetto Vercel) vede la modifica alla scadenza del TTL (60–300 s).
    revalidateCatalogCache(tenantId);
  }
  return { ok: true, data: outcome };
}

export async function setItemStatus(itemId: string, action: 'dismiss' | 'restore', actor: string | null): Promise<ServiceResult<{ status: string }>> {
  const { data: item, error } = await db().from('external_catalog_items').select('tenant_id').eq('id', itemId).maybeSingle();
  if (error) return fromDbError(error);
  if (!item) return fail(404, 'Produit WhatsApp introuvable.');
  const { data, error: rpcError } = await db().rpc('external_catalog_set_item_status', {
    p_tenant_id: item.tenant_id, p_item_id: itemId, p_action: action, p_actor: actor,
  });
  if (rpcError) return fromDbError(rpcError);
  const row = (Array.isArray(data) ? data[0] : data) as { out_status: string };
  return { ok: true, data: { status: row.out_status } };
}

export function newRequestKey(): string {
  return randomUUID();
}
