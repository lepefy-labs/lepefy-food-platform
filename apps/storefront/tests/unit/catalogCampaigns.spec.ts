import { test,expect } from '@playwright/test';
import { campaignActionAllowed,parseCampaignConfig,parseCampaignList } from '../../src/lib/catalog/campaigns';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';

const promotion = {
  name:'  Fête d’automne  ',kind:'promotion',discount_mode:'percent',discount_value:15,
  promo_starts_at:'2026-10-20T07:00:00Z',promo_ends_at:'2026-10-31T22:59:00Z',
  promo_until_sold_out:true,novelty_starts_at:null,novelty_ends_at:null,
};

test('normalizes a tenant campaign without trusting status or tenant fields', () => {
  const result = parseCampaignConfig({ ...promotion,tenant_id:'other',status:'running' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.name).toBe('Fête d’automne');
  expect(result.value.promo_starts_at).toBe('2026-10-20T07:00:00.000Z');
  expect(result.value).not.toHaveProperty('tenant_id');
  expect(result.value).not.toHaveProperty('status');
});

test('rejects discounts and calendars that cannot be published safely', () => {
  for (const invalid of [
    { ...promotion,discount_value:0 },
    { ...promotion,discount_value:100 },
    { ...promotion,discount_mode:'fixed',discount_value:-1 },
    { ...promotion,promo_ends_at:'2026-10-19T00:00:00Z' },
    { ...promotion,promo_starts_at:'not a date' },
    { ...promotion,kind:'novelty',novelty_ends_at:null },
  ]) expect(parseCampaignConfig(invalid).ok).toBe(false);
});

test('distinct calendars and server-side list bounds', () => {
  const result = parseCampaignConfig({ ...promotion,kind:'mixed',novelty_starts_at:'2026-11-01T09:00:00Z',
    novelty_ends_at:'2026-11-16T09:00:00Z' });
  expect(result.ok).toBe(true);
  const list = parseCampaignList(new URLSearchParams('page=-3&size=999&kind=unknown&sort=unknown'));
  expect(list).toMatchObject({ page:1,size:25,kind:'',sort:'created_desc' });
});

test('only meaningful lifecycle actions are offered', () => {
  expect(campaignActionAllowed('draft','publish')).toBe(true);
  expect(campaignActionAllowed('running','suspend')).toBe(true);
  expect(campaignActionAllowed('suspended','resume')).toBe(true);
  expect(campaignActionAllowed('ended','resume')).toBe(false);
  expect(campaignActionAllowed('running','publish')).toBe(false);
});

test('campaign APIs require catalog permissions on the server', () => {
  expect(permissionForAdminApi('/api/admin/catalogue/campagnes','GET')).toBe('catalog.view');
  expect(permissionForAdminApi('/api/admin/catalogue/campagnes/id/action','POST')).toBe('catalog.manage');
  expect(permissionForAdminApi('/api/admin/catalogue/campagnes/id/products','DELETE')).toBe('catalog.manage');
});
