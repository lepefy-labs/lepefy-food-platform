import { expect, test } from '@playwright/test';
import { decideTestTenantDelivery } from '../../src/lib/notifications/testTenantGuard';
import { resolvePacklinkApiKey } from '../../src/lib/shipping/packlinkApiKey';
import { FEATURE_FLAG_KEY_PATTERN } from '../../src/lib/featureFlags/featureFlagRegistry';

const email = { tenantId: 't', recipients: ['client@real.example'], subject: 'Commande confirmée', html: '<p>x</p>' };

test('test tenant email is redirected to the test recipients with a [TEST] subject', () => {
  const decision = decideTestTenantDelivery('/webhook/send-email', email, ['qa@lepefy.com']);
  expect(decision).toEqual({
    action: 'send',
    payload: { ...email, recipients: ['qa@lepefy.com'], subject: '[TEST] Commande confirmée' },
  });
});

test('test tenant email is skipped without TEST_TENANT_EMAIL_RECIPIENT', () => {
  expect(decideTestTenantDelivery('/webhook/send-email', email, [])).toMatchObject({ action: 'skip' });
});

test('test tenant subject prefix is not doubled on retry', () => {
  const decision = decideTestTenantDelivery('/webhook/send-email', { ...email, subject: '[TEST] Déjà' }, ['qa@lepefy.com']);
  expect(decision.action === 'send' && decision.payload.subject).toBe('[TEST] Déjà');
});

test('test tenant non-email n8n webhooks are skipped', () => {
  expect(decideTestTenantDelivery('/webhook/order-confirmed', email, ['qa@lepefy.com'])).toMatchObject({
    action: 'skip', channel: 'n8n /webhook/order-confirmed',
  });
});

test('packlink key: tenant key wins, test tenant never falls back to the platform key', () => {
  const previous = process.env.PACKLINK_API_KEY;
  process.env.PACKLINK_API_KEY = 'platform-key';
  try {
    expect(resolvePacklinkApiKey({ packlink_api_key: 'own', is_test: true })).toBe('own');
    expect(resolvePacklinkApiKey({ packlink_api_key: null, is_test: true })).toBeNull();
    expect(resolvePacklinkApiKey({ packlink_api_key: '  ', is_test: false })).toBe('platform-key');
    expect(resolvePacklinkApiKey({ packlink_api_key: null })).toBe('platform-key');
  } finally {
    if (previous === undefined) delete process.env.PACKLINK_API_KEY;
    else process.env.PACKLINK_API_KEY = previous;
  }
});

test('feature flag keys follow the SQL format', () => {
  expect(FEATURE_FLAG_KEY_PATTERN.test('nuovo_checkout')).toBe(true);
  expect(FEATURE_FLAG_KEY_PATTERN.test('Nuovo-Checkout')).toBe(false);
  expect(FEATURE_FLAG_KEY_PATTERN.test('x')).toBe(false);
});
