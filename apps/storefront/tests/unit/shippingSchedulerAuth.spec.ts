import { expect, test } from '@playwright/test';
import { shippingCampaignSchedulerAuthorized } from '../../src/lib/shipping/intelligence/schedulerAuth';
import { shippingSyncSchedulerAuthorized } from '../../src/lib/shipping/shippingSyncAuth';

test('dedicated n8n token authorizes a correctly formed bearer only', () => {
  const authorized = (header: string | null) => shippingCampaignSchedulerAuthorized(header, 'n8n-only-secret', 'old-service-role');
  expect(authorized('Bearer n8n-only-secret')).toBe(true);
  expect(authorized('Bearer wrong-token')).toBe(false);
  expect(authorized('Bearer n8n-only-secret trailing')).toBe(false);
  expect(authorized('n8n-only-secret')).toBe(false);
  expect(authorized(null)).toBe(false);
});

test('GitHub legacy service-role remains valid during controlled cutover', () => {
  expect(shippingCampaignSchedulerAuthorized('Bearer legacy', undefined, 'legacy')).toBe(true);
  expect(shippingCampaignSchedulerAuthorized('Bearer legacy', 'dedicated', 'legacy')).toBe(true);
  expect(shippingCampaignSchedulerAuthorized('Bearer dedicated', 'dedicated', 'legacy')).toBe(true);
});

test('both auth paths fail closed when credentials are absent or incorrect', () => {
  expect(shippingCampaignSchedulerAuthorized('Bearer any', '', '')).toBe(false);
  expect(shippingCampaignSchedulerAuthorized('Bearer any', undefined, '')).toBe(false);
  expect(shippingCampaignSchedulerAuthorized('Bearer wrong', 'dedicated', 'legacy')).toBe(false);
  expect(shippingCampaignSchedulerAuthorized('Bearer dedicated', 'dedicated', '')).toBe(true);
});

test('shipping sync accepts its own n8n token and the legacy service-role only', () => {
  expect(shippingSyncSchedulerAuthorized('Bearer sync-token', 'sync-token', 'legacy')).toBe(true);
  expect(shippingSyncSchedulerAuthorized('Bearer legacy', 'sync-token', 'legacy')).toBe(true);
  expect(shippingSyncSchedulerAuthorized('Bearer campaign-token', 'sync-token', 'legacy')).toBe(false);
  expect(shippingSyncSchedulerAuthorized('Bearer sync-token extra', 'sync-token', 'legacy')).toBe(false);
  expect(shippingSyncSchedulerAuthorized('Bearer any', undefined, '')).toBe(false);
});
