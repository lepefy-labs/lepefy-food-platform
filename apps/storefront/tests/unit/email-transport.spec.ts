import { expect, test } from '@playwright/test';
import { sendViaBrevo, toBrevoMessage } from '../../src/lib/notifications/emailTransport';
import { sendNotification } from '../../src/lib/events/notifyN8n';

const payload = {
  notificationType: 'order_confirmed',
  tenantId: '11111111-1111-4111-8111-111111111111',
  idempotencyKey: 'order-confirmed:abc123',
  recipients: ['client@example.com'],
  subject: '✅ Votre commande est confirmée',
  html: '<p>Merci</p>',
  replyTo: 'aide@shop.example',
  emailBranding: { fromName: 'Chloé Food', fromEmail: 'noreply@lepefy.com' },
};

function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(vars)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  return run().finally(() => {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
}

test('maps a rendered email to the Brevo API body', () => {
  const result = toBrevoMessage({
    ...payload,
    attachments: [{ filename: 'liste.pdf', contentType: 'application/pdf', contentBase64: 'JVBERi0x' }],
  });
  expect('body' in result && result.body).toEqual({
    sender: { name: 'Chloé Food', email: 'noreply@lepefy.com' },
    to: [{ email: 'client@example.com' }],
    subject: '✅ Votre commande est confirmée',
    htmlContent: '<p>Merci</p>',
    replyTo: { email: 'aide@shop.example' },
    attachment: [{ name: 'liste.pdf', content: 'JVBERi0x' }],
    tags: ['order_confirmed'],
    headers: { 'X-Lepefy-Idempotency-Key': 'order-confirmed:abc123' },
  });
});

test('applies the same guards as the n8n workflow', () => {
  expect(toBrevoMessage({ ...payload, emailBranding: { fromName: 'X', fromEmail: 'ceo@evil.example' } })).toEqual({ error: 'sender_not_allowed' });
  expect(toBrevoMessage({ ...payload, recipients: [] })).toEqual({ error: 'invalid_recipients' });
  expect(toBrevoMessage({ ...payload, subject: 'a\nBcc: x@y.z' })).toEqual({ error: 'invalid_subject' });
  expect(toBrevoMessage({ ...payload, attachments: [{ filename: 'run.exe', contentType: 'application/pdf', contentBase64: 'AA==' }] }))
    .toEqual({ error: 'invalid_attachment_name' });
  expect(toBrevoMessage({ ...payload, attachments: [{ filename: 'a.pdf', contentType: 'text/html', contentBase64: 'AA==' }] }))
    .toEqual({ error: 'invalid_attachment_type' });
});

test('returns the Brevo message id on success and the API error otherwise', async () => {
  await withEnv({ BREVO_API_KEY: 'test-key' }, async () => {
    const calls: RequestInit[] = [];
    const ok = await sendViaBrevo(payload, async (_url, init) => {
      calls.push(init!);
      return new Response(JSON.stringify({ messageId: '<m1@smtp-relay.mailin.fr>' }), { status: 201 });
    });
    expect(ok).toEqual({ ok: true, transport: 'brevo', httpStatus: 201, messageId: '<m1@smtp-relay.mailin.fr>' });
    expect(new Headers(calls[0]!.headers).get('api-key')).toBe('test-key');

    const rejected = await sendViaBrevo(payload, async () =>
      new Response(JSON.stringify({ code: 'invalid_parameter', message: 'sender is invalid' }), { status: 400 }));
    expect(rejected).toMatchObject({ ok: false, httpStatus: 400, error: 'brevo_http_400 invalid_parameter: sender is invalid' });
  });
  await withEnv({ BREVO_API_KEY: undefined }, async () => {
    expect(await sendViaBrevo(payload, async () => new Response('{}', { status: 201 }))).toEqual({ ok: false, transport: 'brevo', error: 'brevo_api_key_missing' });
  });
});

test('the transport switch routes rendered emails to Brevo and everything else to n8n', async () => {
  const oldFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return String(url).includes('brevo') ? new Response(JSON.stringify({ messageId: '<m2>' }), { status: 201 }) : new Response(null, { status: 200 });
  };
  try {
    await withEnv({ EMAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'k', N8N_WEBHOOK_URL: 'https://n8n.example', N8N_NOTIFICATION_WEBHOOK_SECRET: 's' }, async () => {
      expect(await sendNotification('/webhook/send-email', payload)).toMatchObject({ ok: true, transport: 'brevo', messageId: '<m2>' });
      expect(await sendNotification('/webhook/some-other-hook', { a: 1 })).toMatchObject({ ok: true, transport: 'n8n' });
    });
    await withEnv({ EMAIL_TRANSPORT: undefined, N8N_WEBHOOK_URL: 'https://n8n.example', N8N_NOTIFICATION_WEBHOOK_SECRET: 's' }, async () => {
      expect(await sendNotification('/webhook/send-email', payload)).toMatchObject({ ok: true, transport: 'n8n' });
    });
    expect(urls).toEqual([
      'https://api.brevo.com/v3/smtp/email',
      'https://n8n.example/webhook/some-other-hook',
      'https://n8n.example/webhook/send-email',
    ]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
