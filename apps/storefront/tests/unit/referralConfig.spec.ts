import { test, expect } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REFERRAL_DEFAULTS, REFERRAL_UNAVAILABLE_VIEW, getReferralSettings, referralModule, referralPatchSchema,
  resolveReferralSettings,
} from '../../src/lib/loyalty/referralConfig';
import { resolveModuleConfig } from '../../src/lib/tenantConfig/moduleConfig';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

type Result = { data: unknown; error: unknown } | Error;

function fakeDb(results: Record<string, Result>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const from = (table: string) => {
    const call = { table, ops: [] as Array<[string, unknown[]]> };
    calls.push(call);
    const builder: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          const result = results[table] ?? { data: null, error: null };
          return (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)).then(resolve, reject);
        }
        return (...args: unknown[]) => { call.ops.push([String(prop), args]); return builder; };
      },
    });
    return builder;
  };
  return { db: { from } as unknown as SupabaseClient, calls };
}

const storedConfig = {
  version: 1, max_depth: 4, signup_bonus_points: 20, availability_mode: 'ALL_CUSTOMERS',
  unlock_spending_threshold: null, fraud_max_conversions: 5, fraud_period_days: 7, fraud_action: 'CAP_AT_THRESHOLD',
};

test('valid enabled row maps to the legacy-shaped settings', () => {
  const state = resolveModuleConfig(referralModule, { enabled: true, config: storedConfig });
  expect(resolveReferralSettings(state)).toEqual({
    referral_max_depth: 4, referral_signup_bonus_points: 20, referral_availability_mode: 'ALL_CUSTOMERS',
    referral_unlock_spending_threshold: null, referral_fraud_max_conversions: 5, referral_fraud_period_days: 7,
    referral_fraud_action: 'CAP_AT_THRESHOLD',
  });
});

test('missing row (tenant never configured after 133) runs on the 040 defaults', () => {
  expect(resolveReferralSettings(resolveModuleConfig(referralModule, null))).toEqual({
    referral_max_depth: 2, referral_signup_bonus_points: 0, referral_availability_mode: 'ALL_CUSTOMERS',
    referral_unlock_spending_threshold: null, referral_fraud_max_conversions: 10, referral_fraud_period_days: 30,
    referral_fraud_action: 'FLAG_FOR_REVIEW',
  });
});

test('disabled or invalid rows make the program unavailable', () => {
  expect(resolveReferralSettings(resolveModuleConfig(referralModule, { enabled: false, config: storedConfig }))).toBeNull();
  for (const config of [
    { max_depth: 6 }, { max_depth: 0 }, { signup_bonus_points: -1 }, { fraud_period_days: 0 },
    { fraud_action: 'DELETE_ALL' }, { availability_mode: 'EVERYONE' }, { unlock_spending_threshold: 1.234 },
    { fraud_max_conversions: '10' },
  ]) {
    const state = resolveModuleConfig(referralModule, { enabled: true, config });
    expect(state.status, JSON.stringify(config)).toBe('invalid');
    expect(resolveReferralSettings(state)).toBeNull();
  }
});

test('partial row falls back to the 040 defaults per key', () => {
  const state = resolveModuleConfig(referralModule, { enabled: true, config: { max_depth: 1 } });
  expect(resolveReferralSettings(state)).toMatchObject({ referral_max_depth: 1, referral_fraud_period_days: REFERRAL_DEFAULTS.fraud_period_days });
});

test('reads only the tenant-scoped settings row', async () => {
  const { db, calls } = fakeDb({ tenant_feature_settings: { data: { enabled: true, config: storedConfig }, error: null } });
  expect((await getReferralSettings(db, 'tenant-a'))?.referral_max_depth).toBe(4);
  expect(calls.map((c) => c.table)).toEqual(['tenant_feature_settings']);
  expect(calls[0]!.ops).toContainEqual(['eq', ['tenant_id', 'tenant-a']]);
  expect(calls[0]!.ops).toContainEqual(['eq', ['feature_key', 'referral']]);
});

test('no legacy fallback: a missing row never queries the tenants table', async () => {
  const { db, calls } = fakeDb({ tenant_feature_settings: { data: null, error: null } });
  expect((await getReferralSettings(db, 'tenant-a'))?.referral_max_depth).toBe(REFERRAL_DEFAULTS.max_depth);
  expect(calls.map((c) => c.table)).toEqual(['tenant_feature_settings']);
});

test('unreadable settings fail closed (program unavailable for the request)', async () => {
  const { db, calls } = fakeDb({ tenant_feature_settings: new Error('network') });
  expect(await getReferralSettings(db, 'tenant-a')).toBeNull();
  expect(calls.map((c) => c.table)).toEqual(['tenant_feature_settings']);
});

test('unavailable view never makes anyone eligible automatically', () => {
  expect(REFERRAL_UNAVAILABLE_VIEW.referral_availability_mode).toBe('ADMIN_GRANTED_ONLY');
  expect(REFERRAL_UNAVAILABLE_VIEW.referral_signup_bonus_points).toBe(0);
});

test('admin PATCH schema is strict and excludes the signup bonus', () => {
  expect(referralPatchSchema.safeParse({ config: { max_depth: 3, fraud_action: 'AUTO_BLOCK' } }).success).toBe(true);
  expect(referralPatchSchema.safeParse({ config: { signup_bonus_points: 100 } }).success).toBe(false);
  expect(referralPatchSchema.safeParse({ config: { referral_max_depth: 3 } }).success).toBe(false);
  expect(referralPatchSchema.safeParse({ enabled: false, config: {} }).success).toBe(false);
  expect(referralPatchSchema.safeParse({ config: { max_depth: 9 } }).success).toBe(false);
});

test('referral settings keep the permission of the former tenant route', () => {
  expect(permissionForAdminApi('/api/admin/loyalty/referral', 'PATCH')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/loyalty/referral', 'GET')).toBe('tenant_settings.view');
});
