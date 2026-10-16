import { expect, test } from '@playwright/test';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { buildTemplatePreviews, buildWhatsappTemplatePreviews } from '../../src/lib/notifications/templateCatalog';
import { overallHealth, type NotificationHealth } from '../../src/lib/notifications/notificationHealth';
import { checkBrevoAccount } from '../../src/lib/notifications/emailTransport';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111', tenantSlug: 'chloefood', tenantName: 'Chloé Food',
  storefrontUrl: 'https://shop.example', locale: 'fr-FR', currency: 'EUR',
  branding: { logoUrl: null, primaryColor: '#8a2be2', secondaryColor: '#ffb000', accentColor: '#fff' },
  emailBranding: { fromName: 'Chloé Food', fromEmail: 'noreply@lepefy.com', supportEmail: 'aide@shop.example', whatsappNumber: null },
  business: { city: 'Milano', country: 'IT', legalAddress: null },
  pickup: { address: 'Via Roma 1', mapsUrl: 'https://maps.example/x', hours: 'Lun-Ven 9-18' },
} satisfies TenantNotificationContext;

test('card confirmation previews use real tenant media and include the no-image fallback', () => {
  const previews = buildTemplatePreviews({ ...context, branding: { ...context.branding, heroImageUrl: 'https://cdn.example/hero.jpg', emailHeroImageUrl: 'https://shop.example/images/email/shop-art.png' } });
  const real = previews.find((preview) => preview.id === 'card-quick-payment-customer');
  const fallback = previews.find((preview) => preview.id === 'card-quick-payment-customer-no-image');
  expect(real?.html).toContain('<img src="https://shop.example/images/email/shop-art.png"');
  expect(fallback?.html).not.toContain('https://cdn.example/hero.jpg');
  expect(fallback?.html).not.toContain('https://shop.example/images/email/shop-art.png');
  expect(fallback?.html).toContain('COMMANDER EN LIGNE →');
});

test('every template renders a subject and HTML with unique ids', () => {
  const previews = buildTemplatePreviews(context, new Date('2026-09-27T10:00:00Z'));
  expect(previews.length).toBeGreaterThanOrEqual(25);
  expect(new Set(previews.map((preview) => preview.id)).size).toBe(previews.length);
  for (const preview of previews) {
    expect(preview.subject.trim().length, preview.id).toBeGreaterThan(0);
    expect(preview.html.length, preview.id).toBeGreaterThan(200);
    expect(preview.html, preview.id).not.toContain('undefined');
    expect(preview.html, preview.id).not.toContain('[object Object]');
  }
});

function health(partial: Partial<NotificationHealth>): NotificationHealth {
  return {
    transport: 'brevo', config: [{ label: 'x', ok: true, detail: '' }], brevo: { ok: true, plans: [] },
    ledger: { available: true, last24h: {}, last7d: {}, overdueRetries: 0, stuckProcessing: 0, lastAcceptedAt: null },
    digest: { enabled: true, timezone: 'Europe/Rome', lastRun: null }, recipients: [],
    whatsapp: { flagEnabled: false, configured: false, configSource: null, configDetail: null, instance: null, checkedAt: '', queued: 0, retriesDue: 0, unknown: 0, last24h: {}, recentErrors: [] },
    ...partial,
  };
}

test('overall health escalates on configuration errors and stalled retries', () => {
  expect(overallHealth(health({}))).toBe('ok');
  const wa = health({}).whatsapp;
  // WhatsApp only matters once the tenant flag is on.
  expect(overallHealth(health({ whatsapp: { ...wa, flagEnabled: true } }))).toBe('error');
  expect(overallHealth(health({ whatsapp: { ...wa, flagEnabled: true, configured: true, instance: { state: 'notAuthorized', ok: false } } }))).toBe('error');
  expect(overallHealth(health({ whatsapp: { ...wa, flagEnabled: true, configured: true, instance: { state: 'authorized', ok: true }, unknown: 1 } }))).toBe('warning');
  expect(overallHealth(health({ brevo: { ok: false, error: 'brevo_http_401' } }))).toBe('error');
  expect(overallHealth(health({ config: [{ label: 'Clé API Brevo', ok: false, detail: 'Absente' }] }))).toBe('error');
  expect(overallHealth(health({ ledger: { available: true, last24h: {}, last7d: {}, overdueRetries: 2, stuckProcessing: 0, lastAcceptedAt: null } }))).toBe('warning');
  expect(overallHealth(health({ digest: { enabled: true, timezone: 'Europe/Rome', lastRun: { localDate: '2026-09-28', status: 'failed', acceptedAt: null, errorCode: 'x' } } }))).toBe('warning');
});

test('Brevo account check reports plans without exposing the key', async () => {
  const saved = process.env.BREVO_API_KEY;
  process.env.BREVO_API_KEY = 'k';
  try {
    const status = await checkBrevoAccount(async () => new Response(JSON.stringify({ plan: [{ type: 'free', credits: 297, creditsType: 'sendLimit' }] }), { status: 200 }));
    expect(status).toEqual({ ok: true, plans: [{ type: 'free', credits: 297, creditsType: 'sendLimit' }] });
    expect(await checkBrevoAccount(async () => new Response('{}', { status: 401 }))).toEqual({ ok: false, error: 'brevo_http_401' });
  } finally {
    if (saved === undefined) delete process.env.BREVO_API_KEY; else process.env.BREVO_API_KEY = saved;
  }
});

test('every staff notification has an email and a WhatsApp model, same samples, within limits', () => {
  const whatsapp = buildWhatsappTemplatePreviews(context);
  const emails = buildTemplatePreviews(context);
  expect(whatsapp.length).toBeGreaterThanOrEqual(15);
  expect(new Set(whatsapp.map((preview) => preview.id)).size).toBe(whatsapp.length);
  for (const preview of whatsapp) {
    expect(emails.some((email) => email.id === preview.id && email.audience === 'Équipe du tenant'), preview.id).toBe(true);
    expect(preview.text, preview.id).toContain('*Lepefy · Chloé Food*');
    expect(preview.text, preview.id).not.toMatch(/undefined|null|\[object Object\]/);
    expect(preview.length, preview.id).toBeLessThanOrEqual(preview.maxLength);
    // Links only from the tenant's canonical storefront URL.
    for (const url of preview.text.match(/https?:\/\/\S+/g) ?? []) {
      expect(url.startsWith('https://shop.example/admin') || url.startsWith('https://tracking.example/'), `${preview.id}: ${url}`).toBe(true);
    }
  }
  const order = whatsapp.find((preview) => preview.id === 'staff-order-created-priority')!;
  expect(order.text).toContain('🟠 PRIORITAIRE');
  expect(order.text).not.toContain('Packlink PRO :');
  expect(order.text).toContain('📋 *À FAIRE*');
  expect(whatsapp.find((preview) => preview.id === 'staff-test')!.text).toContain('[TEST]');
});
