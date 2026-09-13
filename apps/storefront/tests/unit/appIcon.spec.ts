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

test('composes transparent artwork onto a full tenant-color canvas', async () => {
  const artwork = await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: await sharp({ create: { width: 220, height: 120, channels: 4, background: '#ef4444' } }).png().toBuffer(),
    left: 146,
    top: 196,
  }]).png().toBuffer();

  for (const [size, artworkScale] of [[192, 0.82], [512, 0.62]] as const) {
    const output = await generateTenantAppIconBuffer({
      imageUrl: `data:image/png;base64,${artwork.toString('base64')}`,
      size,
      backgroundColor: '#1267C7',
      artworkScale,
    });
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(size);
    expect(info.height).toBe(size);
    expect(Array.from(data.subarray(0, 3))).toEqual([18, 103, 199]);
    const center = (Math.floor(size / 2) * size + Math.floor(size / 2)) * info.channels;
    expect(Array.from(data.subarray(center, center + 3))).toEqual([239, 68, 68]);
  }
});

test('trims a uniform white source canvas instead of creating a floating white card', async () => {
  const source = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#ffffff' } })
    .composite([{
      input: await sharp({ create: { width: 220, height: 120, channels: 3, background: '#22c55e' } }).png().toBuffer(),
      left: 146,
      top: 196,
    }])
    .png()
    .toBuffer();
  const output = await generateTenantAppIconBuffer({
    imageUrl: `data:image/png;base64,${source.toString('base64')}`,
    size: 192,
    backgroundColor: '#1267C7',
    artworkScale: 0.82,
  });
  const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
  expect(Array.from(data.subarray(0, 3))).toEqual([18, 103, 199]);
  const center = (96 * 192 + 96) * info.channels;
  expect(Array.from(data.subarray(center, center + 3))).toEqual([34, 197, 94]);
});

test('protects app-icon writes with tenant settings management', () => {
  expect(permissionForAdminApi('/api/admin/app-icon', 'POST')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/app-icon', 'DELETE')).toBe('tenant_settings.manage');
});
