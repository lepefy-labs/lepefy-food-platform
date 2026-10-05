import { expect, test } from '@playwright/test';
import {
  ambassadorDisplayName,
  ambassadorSettingsIssues,
  ambassadorSettingsSchema,
  cancelRequestSchema,
  defaultPayoutReference,
  derivedCommissionRate,
  maskIban,
  normalizeAmbassadorSettings,
  payoutDestination,
  payoutRequestSchema,
  payoutState,
  proportionalCommission,
  settingsEqual,
  type AmbassadorSettings,
} from '../../src/lib/ambassador/ambassadorAdmin';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const proportional: AmbassadorSettings = {
  ambassador_min_purchase_amount: 20,
  ambassador_min_commission_amount: 5,
  ambassador_max_commission_amount: 50,
  ambassador_loyalty_from_second_order: false,
  ambassador_first_order_discount_type: null,
  ambassador_first_order_discount_value: null,
  ambassador_payout_threshold_amount: 50,
  ambassador_commission_mode: 'PROPORTIONAL',
  ambassador_split_pool_amount: null,
  ambassador_split_pool_ambassador_percent: null,
};

const pool: AmbassadorSettings = {
  ...proportional,
  ambassador_min_purchase_amount: 50,
  ambassador_commission_mode: 'SPLIT_POOL',
  ambassador_split_pool_amount: 5,
  ambassador_split_pool_ambassador_percent: 50,
};

test('valid configurations have no issue', () => {
  expect(ambassadorSettingsIssues(proportional)).toEqual([]);
  expect(ambassadorSettingsIssues(pool)).toEqual([]);
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_first_order_discount_type: 'PERCENT', ambassador_first_order_discount_value: 10 })).toEqual([]);
});

test('a zero threshold is rejected (division by zero at delivery)', () => {
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_min_purchase_amount: 0 })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...pool, ambassador_min_purchase_amount: 0 }).length).toBeGreaterThan(0);
});

test('proportional invariants', () => {
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_min_commission_amount: 30 })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_max_commission_amount: 4 })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_first_order_discount_type: 'PERCENT', ambassador_first_order_discount_value: 0 })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_first_order_discount_type: 'PERCENT', ambassador_first_order_discount_value: 120 })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...proportional, ambassador_first_order_discount_type: 'FIXED', ambassador_first_order_discount_value: 25 })).toHaveLength(1);
});

test('pool invariants', () => {
  expect(ambassadorSettingsIssues({ ...pool, ambassador_split_pool_amount: null })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...pool, ambassador_split_pool_amount: 0 })).toHaveLength(1);
  expect(ambassadorSettingsIssues({ ...pool, ambassador_split_pool_ambassador_percent: null })).toHaveLength(1);
  // Referred share (60 €) above the 50 € threshold.
  expect(ambassadorSettingsIssues({ ...pool, ambassador_split_pool_amount: 120 })).toHaveLength(1);
  // Pool fields are ignored in proportional mode and vice versa.
  expect(ambassadorSettingsIssues({ ...pool, ambassador_max_commission_amount: 0 })).toEqual([]);
});

test('schema and normalization', () => {
  expect(ambassadorSettingsSchema.safeParse(proportional).success).toBe(true);
  expect(ambassadorSettingsSchema.safeParse({ ...proportional, ambassador_min_purchase_amount: -1 }).success).toBe(false);
  expect(ambassadorSettingsSchema.safeParse({ ...proportional, legal_name: 'x' }).success).toBe(false);
  expect(ambassadorSettingsSchema.safeParse({ ...proportional, ambassador_commission_mode: 'OTHER' }).success).toBe(false);
  const normalized = normalizeAmbassadorSettings({ ...proportional, ambassador_first_order_discount_value: 10 });
  expect(normalized.ambassador_first_order_discount_value).toBeNull();
  expect(settingsEqual(normalized, proportional)).toBe(true);
  expect(settingsEqual(proportional, { ...proportional, ambassador_payout_threshold_amount: 40 })).toBe(false);
});

test('commission formula mirrors SQL', () => {
  const rate = derivedCommissionRate(20, 5);
  expect(rate).toBe(0.25);
  expect(proportionalCommission(40, rate, 50)).toBe(10);
  expect(proportionalCommission(400, rate, 50)).toBe(50);
  // After a discount the commission falls below the "commission au seuil".
  expect(proportionalCommission(18, rate, 50)).toBe(4.5);
  expect(derivedCommissionRate(0, 5)).toBe(0);
});

test('payout state', () => {
  expect(payoutState(0, 50, true)).toBe('nothing');
  expect(payoutState(10, 50, false)).toBe('profile_incomplete');
  expect(payoutState(10, 50, true)).toBe('below_threshold');
  expect(payoutState(50, 50, true)).toBe('ready');
});

test('payout destination and labels', () => {
  expect(maskIban('IT60 X054 2811 1010 0000 0123 456')).toBe('IT60 •••• 3456');
  expect(payoutDestination({ ambassador_payment_method: 'IBAN', ambassador_iban: 'IT60 X054 2811 1010 0000 0123 456' }))
    .toEqual({ method: 'IBAN', label: 'IBAN', value: 'IT60X0542811101000000123456', masked: 'IT60 •••• 3456' });
  expect(payoutDestination({ ambassador_payment_method: 'PAYPAL', ambassador_paypal_email: 'a@b.it' })?.value).toBe('a@b.it');
  expect(payoutDestination({ ambassador_payment_method: 'IBAN', ambassador_iban: null })).toBeNull();
  expect(payoutDestination({ ambassador_payment_method: null })).toBeNull();
  expect(ambassadorDisplayName({ ambassador_first_name: 'Mario', ambassador_last_name: 'Rossi', full_name: 'M' })).toBe('Mario Rossi');
  expect(ambassadorDisplayName({ full_name: null, email: 'a@b.it' })).toBe('a@b.it');
  expect(defaultPayoutReference({ ambassador_last_name: 'Rossi' }, new Date('2026-10-05T10:00:00Z'))).toBe('Commission ambassadeur Rossi 2026-10');
});

test('request schemas', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  expect(payoutRequestSchema.safeParse({ ambassadorId: id, commissionIds: [id], paymentNote: 'ref' }).success).toBe(true);
  expect(payoutRequestSchema.safeParse({ ambassadorId: id, commissionIds: [] }).success).toBe(false);
  expect(payoutRequestSchema.safeParse({ ambassadorId: 'x', commissionIds: [id] }).success).toBe(false);
  expect(cancelRequestSchema.safeParse({ reason: '  ab ' }).success).toBe(false);
  expect(cancelRequestSchema.safeParse({ reason: 'remboursée' }).success).toBe(true);
});

test('permissions of the ambassador API', () => {
  expect(permissionForAdminApi('/api/admin/ambassador/settings', 'PATCH')).toBe('tenant_settings.manage');
  expect(permissionForAdminApi('/api/admin/ambassador/payouts', 'POST')).toBe('growth.payouts.manage');
  expect(permissionForAdminApi('/api/admin/ambassador/commissions/abc/cancel', 'POST')).toBe('growth.payouts.manage');
  expect(permissionForAdminApi('/api/admin/ambassador/commissions', 'GET')).toBe('growth.manage');
  expect(permissionForAdminApi('/api/admin/ambassador/customers-search', 'GET')).toBe('growth.manage');
  expect(permissionForAdminApi('/api/admin/ambassador/promote', 'POST')).toBe('growth.manage');
});
