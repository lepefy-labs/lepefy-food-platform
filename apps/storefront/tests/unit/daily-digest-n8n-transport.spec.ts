import { expect, test } from '@playwright/test';
import { notifyN8n } from '../../src/lib/events/notifyN8n';

test('digest fails closed without its dedicated outbound webhook secret', async () => {
  const oldUrl = process.env.N8N_WEBHOOK_URL;
  const oldSecret = process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
  const oldFetch = globalThis.fetch;
  let called = false;
  try {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example';
    delete process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
    globalThis.fetch = async () => { called = true; return new Response(null, { status: 200 }); };
    expect(await notifyN8n('/webhook/daily-order-digest', { test: true })).toBe(false);
    expect(called).toBe(false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.N8N_WEBHOOK_URL; else process.env.N8N_WEBHOOK_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
    else process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET = oldSecret;
  }
});

test('digest sends secret only to its own webhook and normalizes the base URL', async () => {
  const oldUrl = process.env.N8N_WEBHOOK_URL;
  const oldSecret = process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
  const oldFetch = globalThis.fetch;
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  try {
    process.env.N8N_WEBHOOK_URL = 'https://n8n.example/webhook';
    process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET = 'test-only-secret';
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 200 });
    };
    expect(await notifyN8n('/webhook/daily-order-digest', { test: true })).toBe(true);
    expect(await notifyN8n('/webhook/order-confirmed', { test: true })).toBe(true);
    expect(requests[0]!.url).toBe('https://n8n.example/webhook/daily-order-digest');
    expect(new Headers(requests[0]!.init?.headers).get('X-Lepefy-Webhook-Secret')).toBe('test-only-secret');
    expect(new Headers(requests[1]!.init?.headers).has('X-Lepefy-Webhook-Secret')).toBe(false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.N8N_WEBHOOK_URL; else process.env.N8N_WEBHOOK_URL = oldUrl;
    if (oldSecret === undefined) delete process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET;
    else process.env.N8N_DAILY_DIGEST_WEBHOOK_SECRET = oldSecret;
  }
});
