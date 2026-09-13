import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { APP_ICON_MAX_BYTES, buildPwaIconPath, getAppIconRevision, resolveTenantAppIconSource, validateAppIconMetadata } from '../../src/lib/tenant/appIcon';
import { generateTenantAppIconBuffer } from '../../src/lib/tenant/generateIconBuffer';

test('validates the dedicated 512px PNG contract', () => {
  expect(validateAppIconMetadata({ mimeType: 'image/png', byteLength: APP_ICON_MAX_BYTES, format: 'png', width: 512, height: 512, pages: 1 })).toBeNull();
  expect(validateAppIconMetadata({ mimeType: 'image/jpeg', byteLength: 100, format: 'jpeg', width: 512, height: 512 })).toContain('PNG');
  expect(validateAppIconMetadata({ mimeType: 'image/png', byteLength: 100, format: 'png', width: 511, height: 512 })).toContain('512');
  expect(validateAppIconMetadata({ mimeType: 'image/png', byteLength: APP_ICON_MAX_BYTES + 1, format: 'png', width: 512, height: 512 })).toContain('1 Mo');
});

test('prefers app_icon_url and preserves logo_url fallback', () => {
  expect(resolveTenantAppIconSource(' https://cdn.example/app.png?v=2 ', 'https://cdn.example/logo.png')).toEqual({ url: 'https://cdn.example/app.png?v=2', dedicated: true });
  expect(resolveTenantAppIconSource(null, 'https://cdn.example/logo.png')).toEqual({ url: 'https://cdn.example/logo.png', dedicated: false });
  expect(resolveTenantAppIconSource(null, null)).toBeNull();
});

test('propagates stored revisions through generated endpoint URLs', () => {
  const revision = getAppIconRevision('https://cdn.example/app.png?v=1700');
  expect(buildPwaIconPath(192, 'maskable', revision)).toBe('/api/pwa-icon?size=192&purpose=maskable&revision=1700');
  expect(buildPwaIconPath(180, undefined, revision)).toBe('/api/pwa-icon?size=180&revision=1700');
});

test('transparent artwork gets a full tenant-color canvas at every requested size', async () => {
  const artwork = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: await sharp({ create: { width: 220, height: 220, channels: 4, background: '#ef4444' } }).png().toBuffer(),
    left: 146,
    top: 146,
  }]).png().toBuffer();
  const imageUrl = `data:image/png;base64,${artwork.toString('base64')}`;

  for (const size of [192, 512]) {
    const output = await generateTenantAppIconBuffer({ imageUrl, size, backgroundColor: '#1267C7' });
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(size);
    expect(info.height).toBe(size);
    expect(info.channels).toBe(3);
    expect(Array.from(data.subarray(0, 3))).toEqual([18, 103, 199]);
    const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * info.channels;
    expect(Array.from(data.subarray(center, center + 3))).toEqual([239, 68, 68]);
  }
});

test('opaque finished artwork is not wrapped in the tenant color', async () => {
  const artwork = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#22c55e' } }).png().toBuffer();
  const output = await generateTenantAppIconBuffer({
    imageUrl: `data:image/png;base64,${artwork.toString('base64')}`,
    size: 192,
    backgroundColor: '#1267C7',
  });
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBe(192);
  expect(info.height).toBe(192);
  expect(Array.from(data.subarray(0, 3))).toEqual([34, 197, 94]);
});

test('protects app-icon writes with tenant settings management', () => {
  expect(permissionForAdminApi('/api/admin/app-icon', 'POST')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/app-icon', 'DELETE')).toBe('tenant_settings.manage');
});
