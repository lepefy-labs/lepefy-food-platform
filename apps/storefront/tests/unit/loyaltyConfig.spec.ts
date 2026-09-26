import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  LOYALTY_DEFAULTS, getLoyaltySettings, loyaltyModule, loyaltyPatchSchema, resolveLoyaltySettings,
} from '../../src/lib/loyalty/loyaltyConfig';
import { mergeModuleConfig, resolveModuleConfig } from '../../src/lib/tenantConfig/moduleConfig';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

function dbReturning(result: { data: unknown; error: unknown } | Error) {
  const eqCalls: unknown[][] = [];
  const builder: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
      }
      return (...args: unknown[]) => { if (prop === 'eq') eqCalls.push(args); return builder; };
    },
  });
  return { db: { from: () => builder } as unknown as SupabaseClient, eqCalls };
}

test('missing settings row (tenant created after 131) keeps the program off', () => {
  expect(resolveLoyaltySettings(resolveModuleConfig(loyaltyModule, null))).toEqual({
    enabled: false,
    purchasePointsRate: LOYALTY_DEFAULTS.purchase_points_rate,
    pointsToCurrencyRate: LOYALTY_DEFAULTS.points_to_currency_rate,
  });
});

test('stored row is used as-is', () => {
  const state = resolveModuleConfig(loyaltyModule, { enabled: true, config: { version: 1, purchase_points_rate: 2, points_to_currency_rate: 0.05 } });
  expect(resolveLoyaltySettings(state)).toEqual({ enabled: true, purchasePointsRate: 2, pointsToCurrencyRate: 0.05 });
});

test('partial row falls back to the centralized defaults per key', () => {
  const state = resolveModuleConfig(loyaltyModule, { enabled: true, config: { purchase_points_rate: 3 } });
  expect(resolveLoyaltySettings(state)).toEqual({ enabled: true, purchasePointsRate: 3, pointsToCurrencyRate: LOYALTY_DEFAULTS.points_to_currency_rate });
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
    expect(resolveLoyaltySettings(state).enabled).toBe(false);
  }
});

test('read failure fails closed (no points at an unknown rate)', async () => {
  const { db } = dbReturning(new Error('network'));
  expect((await getLoyaltySettings(db, 'tenant-a')).enabled).toBe(false);
});

test('read is tenant-scoped on the loyalty row', async () => {
  const { db, eqCalls } = dbReturning({ data: { enabled: true, config: { version: 1, purchase_points_rate: 0.5, points_to_currency_rate: 0.01 } }, error: null });
  expect(await getLoyaltySettings(db, 'tenant-a')).toEqual({ enabled: true, purchasePointsRate: 0.5, pointsToCurrencyRate: 0.01 });
  expect(eqCalls).toEqual([['tenant_id', 'tenant-a'], ['feature_key', 'loyalty']]);
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
