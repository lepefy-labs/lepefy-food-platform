import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { APP_ICON_MAX_BYTES, buildPwaIconPath, getAppIconRevision, resolveTenantAppIconSource, validateAppIconMetadata } from '../../src/lib/tenant/appIcon';
import { generateIconBuffer } from '../../src/lib/tenant/generateIconBuffer';

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

test('generates exact PNG dimensions without cropping dedicated artwork', async () => {
  const master = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#7c3aed' } }).png().toBuffer();
  const dataUrl = `data:image/png;base64,${master.toString('base64')}`;
  for (const size of [180, 192, 512]) {
    const metadata = await sharp(await generateIconBuffer({ logoUrl: dataUrl, size })).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(size);
    expect(metadata.height).toBe(size);
  }
});

test('protects app-icon writes with tenant settings management', () => {
  expect(permissionForAdminApi('/api/admin/app-icon', 'POST')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/app-icon', 'DELETE')).toBe('tenant_settings.manage');
});
