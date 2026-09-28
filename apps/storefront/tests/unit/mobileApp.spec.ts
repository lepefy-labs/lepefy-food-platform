import { expect, test } from '@playwright/test';
import {
  androidAppEffects, androidAppStatus, parseFingerprints, planAndroidAppUpdate, serializeAndroidApp, splitFingerprints, type AndroidAppRow,
} from '../../src/lib/mobileApp/androidApp';
import { androidAppState } from '../../src/lib/notifications/getTenantNotificationContext';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { PLATFORM_NAV } from '../../src/app/admin/_components/platformNavConfig';

const FP1 = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');
const FP2 = Array.from({ length: 32 }, () => 'AB').join(':');

const row: AndroidAppRow = {
  id: 't1', name: 'Chloe Food', slug: 'chloefood',
  android_package_name: 'com.lepefy.chloefood.twa', android_sha256_fingerprint: `${FP1},${FP2}`, android_public: false,
};

test('status follows the /go rule and drives every consumer consistently', () => {
  expect(androidAppStatus(null, true)).toBe('none');
  expect(androidAppStatus('pas un package', true)).toBe('none');
  expect(androidAppStatus('com.a.b', false)).toBe('testing');
  expect(androidAppStatus('com.a.b', true)).toBe('public');
  expect(androidAppState('com.a.b', false)).toEqual({ status: 'coming_soon', playStoreUrl: null });
  expect(androidAppState('com.a.b', true)?.playStoreUrl).toBe('https://play.google.com/store/apps/details?id=com.a.b');
  expect(androidAppEffects('public', true)).toEqual({ go: 'Android → fiche Play Store', email: 'Badge Google Play cliquable', assetLinks: 'Servi (vérification du domaine)' });
  expect(androidAppEffects('testing', false).assetLinks).toBe('Vide');
  expect(androidAppEffects('none', true).email).toBe('Aucun bloc application');
});

test('fingerprints: stored list round-trips, input is normalized and strictly validated', () => {
  expect(splitFingerprints(` ${FP1} , ${FP2} `)).toEqual([FP1, FP2]);
  expect(serializeAndroidApp(row)).toMatchObject({ fingerprints: [FP1, FP2], status: 'testing', isPublic: false });
  expect(parseFingerprints(`${FP1.toLowerCase()}\n\n${FP2}, ${FP2}`)).toEqual({ ok: true, values: [FP1, FP2] });
  expect(parseFingerprints('AA:BB:CC').ok).toBe(false);
  expect(parseFingerprints(FP1.replace(/:/g, '')).ok).toBe(false);
  expect(parseFingerprints('')).toEqual({ ok: true, values: [] });
});

test('fingerprints change only with explicit confirmation', () => {
  expect(planAndroidAppUpdate(row, { packageName: 'com.lepefy.chloefood.twa' })).toEqual({ ok: true, update: {} });
  // A forged payload without confirm = true is refused.
  const unconfirmed = planAndroidAppUpdate(row, { fingerprints: { value: FP1, confirm: false } } as never);
  expect(unconfirmed).toMatchObject({ ok: false, status: 400 });
  expect(planAndroidAppUpdate(row, { fingerprints: { value: FP1, confirm: true } }))
    .toEqual({ ok: true, update: { android_sha256_fingerprint: FP1 } });
  expect(planAndroidAppUpdate(row, { fingerprints: { value: 'faux', confirm: true } })).toMatchObject({ ok: false, status: 400 });
});

test('publish and unpublish guard the package', () => {
  expect(planAndroidAppUpdate(row, { isPublic: true })).toEqual({ ok: true, update: { android_public: true } });
  expect(planAndroidAppUpdate({ ...row, android_package_name: null }, { isPublic: true })).toMatchObject({ ok: false, status: 400 });
  const live = { ...row, android_public: true };
  expect(planAndroidAppUpdate(live, { isPublic: false })).toEqual({ ok: true, update: { android_public: false } });
  // Changing the package of a public app must go back to testing first.
  expect(planAndroidAppUpdate(live, { packageName: 'com.autre.app' })).toMatchObject({ ok: false, status: 409 });
  expect(planAndroidAppUpdate(row, { packageName: 'com.autre.app' })).toEqual({ ok: true, update: { android_package_name: 'com.autre.app' } });
  expect(planAndroidAppUpdate(row, { packageName: '' })).toEqual({ ok: true, update: { android_package_name: null, android_public: false } });
  expect(planAndroidAppUpdate(row, { packageName: 'invalide' })).toMatchObject({ ok: false, status: 400 });
});

test('platform-owner only: no tenant capability grants the API, page is in the platform nav', () => {
  for (const path of ['/api/admin/platform/mobile-app', '/api/admin/platform/mobile-app/listing']) {
    for (const method of ['GET', 'PATCH', 'POST']) expect(permissionForAdminApi(path, method)).toBeNull();
  }
  expect(PLATFORM_NAV.find((group) => group.id === 'mobile-app')?.href).toBe('/admin/platform/application-mobile');
});
