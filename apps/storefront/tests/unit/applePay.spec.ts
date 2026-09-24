import { expect, test } from '@playwright/test';
import type { PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import {
  detectApplePayClientSupport,
  isApplePayEnabledForCard,
  resolveApplePayDomain,
  visibleCardPaymentMethods,
} from '../../src/lib/payments/applePay';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

function row(method: TenantPaymentMethod['method'], active = true, enabled_modules: PaymentModule[] = ['card']): TenantPaymentMethod {
  return { id: `${method}-id`, tenant_id: 't1', method, label: null, value: null, extra: null, sort_order: 0, active, enabled_modules };
}

test('isApplePayEnabledForCard: active apple_pay row scoped to card, independent of the card row', () => {
  expect(isApplePayEnabledForCard([row('apple_pay')])).toBe(true);
  expect(isApplePayEnabledForCard([row('card'), row('apple_pay', true, ['shop', 'card'])])).toBe(true);
  expect(isApplePayEnabledForCard([row('apple_pay', false)])).toBe(false);
  expect(isApplePayEnabledForCard([row('apple_pay', true, ['shop', 'event'])])).toBe(false);
  expect(isApplePayEnabledForCard([row('card'), row('paypal')])).toBe(false);
  expect(isApplePayEnabledForCard([])).toBe(false);
});

test('detectApplePayClientSupport: true only when ApplePaySession.canMakePayments() is true', () => {
  expect(detectApplePayClientSupport(undefined)).toBe(false);
  expect(detectApplePayClientSupport({})).toBe(false);
  expect(detectApplePayClientSupport({ ApplePaySession: {} })).toBe(false);
  expect(detectApplePayClientSupport({ ApplePaySession: { canMakePayments: () => false } })).toBe(false);
  expect(detectApplePayClientSupport({ ApplePaySession: { canMakePayments: () => { throw new Error('insecure context'); } } })).toBe(false);
  expect(detectApplePayClientSupport({ ApplePaySession: { canMakePayments: () => true } })).toBe(true);
});

test('visibleCardPaymentMethods hides the apple_pay tile unless enabled and supported', () => {
  const methods = [row('card'), row('apple_pay'), row('cash')];
  expect(visibleCardPaymentMethods(methods, true, true).map((m) => m.method)).toEqual(['card', 'apple_pay', 'cash']);
  expect(visibleCardPaymentMethods(methods, true, false).map((m) => m.method)).toEqual(['card', 'cash']);
  expect(visibleCardPaymentMethods(methods, false, true).map((m) => m.method)).toEqual(['card', 'cash']);
  expect(visibleCardPaymentMethods([row('apple_pay')], true, false)).toEqual([]);
});

test('resolveApplePayDomain uses tenant storefront_url, then app URL, never a default', () => {
  expect(resolveApplePayDomain('https://Shop.Example.com/card?x=1', 'https://app.example.org')).toBe('shop.example.com');
  expect(resolveApplePayDomain('shop.example.com/', null)).toBe('shop.example.com');
  expect(resolveApplePayDomain(null, 'https://app.example.org:3000/')).toBe('app.example.org');
  expect(resolveApplePayDomain('  ', undefined)).toBeNull();
  expect(resolveApplePayDomain(null, 'http://localhost:3000')).toBeNull();
});

test('apple-pay domain admin route is covered by tenant settings RBAC', () => {
  expect(permissionForAdminApi('/api/admin/payment-methods/apple-pay/domain', 'GET')).toBe('tenant_settings.view');
  expect(permissionForAdminApi('/api/admin/payment-methods/apple-pay/domain', 'POST')).toBe('tenant_settings.manage');
});
