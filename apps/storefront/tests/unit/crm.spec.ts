import { expect, test } from '@playwright/test';
import { normalizeCustomerEmail, normalizeCustomerPhone } from '../../src/lib/customers/normalizeCustomerIdentity';
import { selectAuthCustomerCandidate, selectCustomerCandidate } from '../../src/lib/customers/customerResolutionCore';
import { latestConsentDecision, latestTenantConsentDecision } from '../../src/lib/customers/getCurrentCustomerConsent';
import { validateSegmentDefinition } from '../../src/lib/admin/crm';
import { buildCampaignRecipientSnapshot, campaignRecipientIdempotencyKey, isEligibleMarketingRecipient } from '../../src/lib/marketing/dispatchMarketingCampaign';
import { readFileSync } from 'node:fs';
import path from 'node:path';

test('customer identity normalization remains conservative', () => {
  expect(normalizeCustomerEmail('  Marie@Example.COM ')).toBe('marie@example.com');
  expect(normalizeCustomerPhone('00 33 (0)6 12 34 56 78')).toBe('+330612345678');
  expect(normalizeCustomerPhone('06 12 34')).toBe(null);
});

test('customer resolver selects an existing tenant-scoped guest and ignores another tenant', () => {
  const candidate = selectCustomerCandidate('tenant-a', [
    { id: 'other', tenant_id: 'tenant-b', auth_user_id: null },
    { id: 'guest', tenant_id: 'tenant-a', auth_user_id: null },
  ], 'customer_email_collision');
  expect(candidate?.id).toBe('guest');
  expect(candidate?.auth_user_id).toBeNull();
});

test('customer resolver returns no candidate for a new guest', () => {
  expect(selectCustomerCandidate('tenant-a', [], 'customer_email_collision')).toBeNull();
});

test('customer resolver gives an existing auth identity tenant-scoped precedence', () => {
  expect(selectAuthCustomerCandidate('tenant-a', 'auth-a', [
    { id: 'wrong-tenant', tenant_id: 'tenant-b', auth_user_id: 'auth-a' },
    { id: 'registered', tenant_id: 'tenant-a', auth_user_id: 'auth-a' },
  ])?.id).toBe('registered');
});

test('customer resolver refuses ambiguous collisions', () => {
  expect(() => selectCustomerCandidate('tenant-a', [
    { id: 'one', tenant_id: 'tenant-a', auth_user_id: null },
    { id: 'two', tenant_id: 'tenant-a', auth_user_id: null },
  ], 'customer_email_collision')).toThrow('customer_email_collision');
});

test('latest marketing consent decision wins and no consent is denied', () => {
  expect(latestConsentDecision([]).granted).toBe(false);
  expect(latestConsentDecision([
    { granted: true, created_at: '2026-01-01T00:00:00Z', source: 'checkout' },
    { granted: false, created_at: '2026-02-01T00:00:00Z', source: 'account_settings' },
  ])).toEqual({ granted: false, decidedAt: '2026-02-01T00:00:00Z', source: 'account_settings' });
});

test('current consent cannot leak across tenants', () => {
  expect(latestTenantConsentDecision('tenant-a', [
    { tenant_id: 'tenant-b', granted: true, created_at: '2026-03-01T00:00:00Z', source: 'checkout' },
    { tenant_id: 'tenant-a', granted: false, created_at: '2026-02-01T00:00:00Z', source: 'account_settings' },
  ]).granted).toBe(false);
});

test('segmentation validates AND, OR, numeric, date, tag, consent and RFM fields', () => {
  for (const operator of ['and', 'or'] as const) {
    const definition = validateSegmentDefinition({ operator, conditions: [
      { field: 'orders_count', operator: '>=', value: 3 },
      { field: 'created_at', operator: 'after', value: '2026-01-01' },
      { field: 'tag', operator: '=', value: 'tag-id' },
      { field: 'marketing_consent', operator: '=', value: true },
      { field: 'rfm_segment', operator: 'in', value: ['champion','loyal'] },
    ] });
    expect(definition.operator).toBe(operator);
    expect(definition.conditions).toHaveLength(5);
  }
  expect(() => validateSegmentDefinition({ operator: 'and', conditions: [{ field: 'raw_sql', operator: '=', value: 'x' }] })).toThrow();
});

test('campaign eligibility excludes missing consent and missing destination', () => {
  expect(isEligibleMarketingRecipient({ marketing_consent: true, email: 'client@example.com' })).toBe(true);
  expect(isEligibleMarketingRecipient({ marketing_consent: false, email: 'client@example.com' })).toBe(false);
  expect(isEligibleMarketingRecipient({ marketing_consent: true, email: null })).toBe(false);
});

test('campaign recipient idempotency is stable and customer-specific', () => {
  const first = campaignRecipientIdempotencyKey('campaign', 'customer-a');
  expect(campaignRecipientIdempotencyKey('campaign', 'customer-a')).toBe(first);
  expect(campaignRecipientIdempotencyKey('campaign', 'customer-b')).not.toBe(first);
});

test('campaign snapshot includes only consented destinations and prevents duplicate keys', () => {
  const base = { tenant_id: 'tenant-a', auth_user_id: null, normalized_email: null, full_name: null, phone: null, normalized_phone: null, source: 'guest_checkout', loyalty_card_number: null, created_at: '2026-01-01', updated_at: '2026-01-01', orders_count: 0, completed_orders_count: 0, lifetime_value: 0, average_order_value: 0, first_order_at: null, last_order_at: null, days_since_last_order: null, online_spend: 0, in_store_spend: 0, loyalty_points_balance: 0, last_activity_at: '2026-01-01', event_reservations_count: 0, products_count: 0, favorite_product_id: null, favorite_category_id: null, marketing_consent_at: null, marketing_consent_source: null, rfm_segment: 'new', recency_score: 1, frequency_score: 1, monetary_score: 1 } as const;
  const snapshot = buildCampaignRecipientSnapshot('tenant-a', 'campaign-a', [
    { ...base, id: 'allowed', email: 'allowed@example.com', marketing_consent: true },
    { ...base, id: 'refused', email: 'refused@example.com', marketing_consent: false },
    { ...base, id: 'missing', email: null, marketing_consent: true },
  ]);
  expect(snapshot.map((row) => row.customer_id)).toEqual(['allowed']);
  expect(new Set(snapshot.map((row) => row.idempotency_key)).size).toBe(snapshot.length);
});

test('migration preserves customer ids and existing business foreign keys', () => {
  const migration = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/109_tenant_crm_foundation.sql'), 'utf8');
  expect(migration).toContain('set auth_user_id = id');
  expect(migration).toContain('drop constraint if exists customers_id_fkey');
  expect(migration).not.toMatch(/update\s+public\.(orders|addresses|points_ledger)\s+set\s+customer_id/i);
  expect(migration).not.toMatch(/alter\s+column\s+id/i);
  expect(migration).not.toMatch(/delete\s+from\s+public\.customers/i);
});
