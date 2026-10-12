import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isExternalHttpImage, parseManagedProductImage, resolveProductImage } from '@/lib/images/productImageDelivery';
import { uploadProductImageSet } from '@/lib/images/productImagePipeline';

const tenant = '11111111-1111-1111-1111-111111111111';
const otherTenant = '22222222-2222-2222-2222-222222222222';
const product = '33333333-3333-3333-3333-333333333333';
const image = '44444444-4444-4444-4444-444444444444';
const base = 'https://storage.example.supabase.co';
const master = `${base}/storage/v1/object/public/assets/tenants/${tenant}/products/${product}/${image}/master.png`;

test('resolves only an immutable set owned by the active tenant', () => {
  expect(parseManagedProductImage(master, base, tenant)?.variants.catalog).toBe(master.replace('master.png', 'catalog.webp'));
  expect(resolveProductImage(master, 'thumbnail', true, base, tenant).direct).toBe(true);
  expect(resolveProductImage(master, 'thumbnail', false, base, tenant).src).toBe(master);
  expect(parseManagedProductImage(master, base, otherTenant)).toBeNull();
  expect(parseManagedProductImage(master.replace(base, 'https://attacker.example'), base, tenant)).toBeNull();
  expect(parseManagedProductImage(master.replace('master.png', '%2e%2e/master.png'), base, tenant)).toBeNull();
  expect(parseManagedProductImage(master + '?transform=width:160', base, tenant)).toBeNull();
  expect(parseManagedProductImage('https://external.example/photo.jpg', base, tenant)).toBeNull();
  expect(isExternalHttpImage('https://external.example/photo.jpg', base)).toBe(true);
  expect(isExternalHttpImage('javascript:alert(1)', base)).toBe(false);
  expect(resolveProductImage(null, 'catalog', true, base, tenant).direct).toBe(false);
});

test('uploads a transparent master and four bounded WebP variants', async () => {
  const uploaded = new Map<string, { bytes: Buffer; contentType: string; cacheControl: string }>();
  const bucket = {
    upload: async (path: string, bytes: Buffer, options: { contentType: string; cacheControl: string }) => {
      uploaded.set(path, { bytes, contentType: options.contentType, cacheControl: options.cacheControl });
      return { error: null };
    },
    remove: async () => ({ error: null }),
  };
  const supabase = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  const bytes = await sharp({ create: { width: 1200, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const set = await uploadProductImageSet({ supabase, bytes, mime: 'image/png', tenantId: tenant, productId: product, baseUrl: base, imageId: image });
  expect(set.paths).toHaveLength(5);
  expect(set.url).toBe(master);
  for (const [name, maxWidth] of Object.entries({ thumbnail: 160, catalog: 480, detail: 960, full: 1600 })) {
    const object = uploaded.get(`tenants/${tenant}/products/${product}/${image}/${name}.webp`);
    expect(object?.contentType).toBe('image/webp');
    expect(object?.cacheControl).toBe('31536000');
    const metadata = await sharp(object!.bytes).metadata();
    expect(metadata.width).toBeLessThanOrEqual(maxWidth);
    expect(metadata.width).toBeLessThanOrEqual(1200);
    expect(metadata.hasAlpha).toBe(true);
  }
});

test('cleans new objects if a variant upload fails', async () => {
  const removed: string[][] = [];
  let count = 0;
  const bucket = {
    upload: async () => ({ error: ++count === 3 ? { message: 'storage failed' } : null }),
    remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
  };
  const supabase = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  const bytes = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  await expect(uploadProductImageSet({ supabase, bytes, mime: 'image/jpeg', tenantId: tenant, productId: product, baseUrl: base })).rejects.toThrow('storage failed');
  expect(removed[0]).toHaveLength(2);
});

test('reuses a complete deterministic set and rejects different bytes', async () => {
  const stored = new Map<string, Buffer>();
  const bucket = {
    upload: async (path: string, bytes: Buffer) => {
      if (stored.has(path)) return { error: { message: 'The resource already exists' } };
      stored.set(path, bytes);
      return { error: null };
    },
    download: async (path: string) => ({
      data: new Blob([Uint8Array.from(stored.get(path)!)]),
      error: null,
    }),
    remove: async () => ({ error: null }),
  };
  const supabase = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  const bytes = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
  const input = { supabase, bytes, mime: 'image/jpeg', tenantId: tenant, productId: product, baseUrl: base, imageId: image };
  const first = await uploadProductImageSet(input);
  const retry = await uploadProductImageSet({ ...input, allowExisting: true });
  expect(retry.url).toBe(first.url);
  expect(stored.size).toBe(5);
  const changed = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#000000' } }).jpeg().toBuffer();
  await expect(uploadProductImageSet({ ...input, bytes: changed, allowExisting: true })).rejects.toThrow('differs');
});
