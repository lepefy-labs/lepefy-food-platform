import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LOYALTY_DEFAULTS, getLoyaltySettings, loyaltyModule, loyaltyPatchSchema, resolveLoyaltySettings,
} from '../../src/lib/loyalty/loyaltyConfig';
import { mergeModuleConfig, resolveModuleConfig } from '../../src/lib/tenantConfig/moduleConfig';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const legacy = { loyalty_enabled: true, purchase_points_rate: 1.5, points_to_currency_rate: 0.02 };

function dbReturning(result: { data: unknown; error: unknown } | Error): SupabaseClient {
  const builder: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
      }
      return () => builder;
    },
  });
  return { from: () => builder } as unknown as SupabaseClient;
}

test('missing settings row (migration 130 not applied) keeps legacy behavior', () => {
  expect(resolveLoyaltySettings(resolveModuleConfig(loyaltyModule, null), legacy)).toEqual({
    enabled: true, purchasePointsRate: 1.5, pointsToCurrencyRate: 0.02, source: 'legacy',
  });
  expect(resolveLoyaltySettings(null, { ...legacy, loyalty_enabled: false }).enabled).toBe(false);
});

test('settings row wins over legacy columns', () => {
  const state = resolveModuleConfig(loyaltyModule, { enabled: false, config: { version: 1, purchase_points_rate: 2, points_to_currency_rate: 0.05 } });
  expect(resolveLoyaltySettings(state, legacy)).toEqual({
    enabled: false, purchasePointsRate: 2, pointsToCurrencyRate: 0.05, source: 'module',
  });
});

test('partial settings row falls back to the legacy defaults per key', () => {
  const state = resolveModuleConfig(loyaltyModule, { enabled: true, config: { purchase_points_rate: 3 } });
  expect(resolveLoyaltySettings(state, legacy)).toMatchObject({ purchasePointsRate: 3, pointsToCurrencyRate: LOYALTY_DEFAULTS.points_to_currency_rate });
});

test('invalid settings suspend accrual instead of guessing a rate', () => {
  for (const config of [
    { purchase_points_rate: -1 },
    { purchase_points_rate: 1.23456 },
    { purchase_points_rate: '1.5' },
    { points_to_currency_rate: 1_000_000 },
    { version: 2 },
  ]) {
    const state = resolveModuleConfig(loyaltyModule, { enabled: true, config });
    expect(state.status, JSON.stringify(config)).toBe('invalid');
    expect(resolveLoyaltySettings(state, legacy)).toMatchObject({ enabled: false, purchasePointsRate: 0, source: 'module' });
  }
});

test('read failure falls back to the mirrored legacy columns', async () => {
  const settings = await getLoyaltySettings(dbReturning(new Error('network')), 'tenant-a', legacy);
  expect(settings).toMatchObject({ enabled: true, purchasePointsRate: 1.5, source: 'legacy' });
});

test('stored row is read tenant-scoped and used as-is', async () => {
  const settings = await getLoyaltySettings(
    dbReturning({ data: { enabled: true, config: { version: 1, purchase_points_rate: 0.5, points_to_currency_rate: 0.01 } }, error: null }),
    'tenant-a', { ...legacy, loyalty_enabled: false },
  );
  expect(settings).toEqual({ enabled: true, purchasePointsRate: 0.5, pointsToCurrencyRate: 0.01, source: 'module' });
});

test('partial admin update keeps other values and current activation', () => {
  const next = mergeModuleConfig(loyaltyModule, { enabled: true, config: { version: 1, purchase_points_rate: 1.5, points_to_currency_rate: 0.02 } }, { config: { purchase_points_rate: 2 } });
  expect(next).toEqual({ enabled: true, config: { version: 1, purchase_points_rate: 2, points_to_currency_rate: 0.02 } });
});

test('admin PATCH schema is strict', () => {
  expect(loyaltyPatchSchema.safeParse({ enabled: true, config: { purchase_points_rate: 1.25 } }).success).toBe(true);
  expect(loyaltyPatchSchema.safeParse({ enabled: 'true' }).success).toBe(false);
  expect(loyaltyPatchSchema.safeParse({ config: { purchase_points_rate: -0.5 } }).success).toBe(false);
  expect(loyaltyPatchSchema.safeParse({ config: { referral_signup_bonus_points: 10 } }).success).toBe(false);
  expect(loyaltyPatchSchema.safeParse({ loyalty_enabled: true }).success).toBe(false);
});

test('loyalty settings keep the permission of the former tenant route; scan stays separate', () => {
  expect(permissionForAdminApi('/api/admin/loyalty/settings', 'PATCH')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/loyalty/settings', 'GET')).toBe('tenant_settings.view');
  expect(permissionForAdminApi('/api/admin/loyalty/scan/confirm', 'POST')).toBe('loyalty.scan');
  expect(permissionForAdminApi('/api/admin/loyalty/tiers', 'POST')).toBe('loyalty.manage');
});
