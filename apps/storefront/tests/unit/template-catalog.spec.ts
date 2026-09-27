import { expect, test } from '@playwright/test';
import type { TenantNotificationContext } from '../../src/lib/notifications/getTenantNotificationContext';
import { buildTemplatePreviews } from '../../src/lib/notifications/templateCatalog';
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
    digest: { enabled: true, timezone: 'Europe/Rome', lastRun: null }, recipients: [], ...partial,
  };
}

test('overall health escalates on configuration errors and stalled retries', () => {
  expect(overallHealth(health({}))).toBe('ok');
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
