import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PUBLIC_TENANT_FIELDS, type Tenant } from '@lepefy/types';
import { toPublicTenant } from '../../src/lib/tenant/publicTenant';

// Fields that must never reach the browser (RSC payload / Client Component props).
const PRIVATE_FIELDS = [
  'packlink_api_key', 'chatbox_extra_context', 'stripe_account_id',
  'bank_iban', 'bank_bic', 'bank_beneficiary', 'stripe_payment_link',
  'subscription_status', 'subscription_paid_until',
  'ai_rate_limit_admin_per_day', 'referral_fraud_max_conversions', 'referral_fraud_period_days',
  'referral_fraud_action', 'barcode_prefix', 'barcode_sequence', 'loyalty_card_sequence',
  'google_review_url', 'label_logo_url', 'android_sha256_fingerprint',
  'shipping_pricing_mode', 'shipping_tariff_fallback',
];

const fullRow = {
  id: 't1', slug: 'shop', name: 'Shop', currency: 'EUR', locale: 'fr-FR', locales: ['fr'],
  primary_color: '#000', logo_url: null,
  packlink_api_key: 'secret-packlink', chatbox_extra_context: 'private prompt',
  bank_iban: 'FR7600000000000000000000000', stripe_account_id: 'acct_x',
  subscription_status: 'active', ai_rate_limit_admin_per_day: 200, referral_fraud_action: 'FLAG_FOR_REVIEW',
  loyalty_card_sequence: 42, future_private_column: 'not yet classified',
} as unknown as Tenant;

test('public projection copies only allow-listed fields', () => {
  const projected = toPublicTenant(fullRow) as Record<string, unknown>;
  expect(Object.keys(projected).sort()).toEqual([...PUBLIC_TENANT_FIELDS].sort());
  expect(projected.name).toBe('Shop');
  expect(projected.currency).toBe('EUR');
  const serialized = JSON.stringify(projected);
  for (const secret of ['secret-packlink', 'private prompt', 'FR7600', 'acct_x', 'not yet classified']) {
    expect(serialized).not.toContain(secret);
  }
});

test('allow-list never contains server-only fields', () => {
  const allowed = new Set<string>(PUBLIC_TENANT_FIELDS);
  for (const field of PRIVATE_FIELDS) expect(allowed.has(field), field).toBe(false);
});

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listSourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

test('client components never type props with the full Tenant row', () => {
  const src = join(__dirname, '../../src');
  const offenders = listSourceFiles(src).filter((file) => {
    const code = readFileSync(file, 'utf8');
    if (!/^\s*['"]use client['"]/.test(code)) return false;
    return /import\s+type\s*\{[^}]*\bTenant\b[^}]*\}\s*from\s*['"]@lepefy\/types['"]/.test(code);
  }).map((file) => relative(src, file));
  expect(offenders).toEqual([]);
});
