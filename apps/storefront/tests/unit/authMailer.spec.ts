import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToBase64 } from '../../src/lib/authMailer/core/encoding';
import { issueContext, verifyContext, withContext, contextFromRedirect } from '../../src/lib/authMailer/core/contextToken';
import { signWebhook } from '../../src/lib/authMailer/core/webhook';
import { handleAuthMailHook, type AuditEntry, type HandlerDeps, type TenantMailConfig } from '../../src/lib/authMailer/core/handler';
import { createResendTransport, type MailTransport, type OutgoingMail } from '../../src/lib/authMailer/core/resend';
import { sanitizeSenderName, resolveFromAddress, formatFrom } from '../../src/lib/authMailer/core/sender';
import { renderAuthEmail } from '../../src/lib/authMailer/core/templates';
import { authMailRedirectOptions } from '../../src/lib/authMailer/otpContext';
import { resolveAdminMailIdentity } from '../../src/lib/authMailer/adminMailTenant';

const WH_SECRET = `v1,whsec_${bytesToBase64(new Uint8Array(32).fill(7))}`;
const CTX_SECRET = 'ctx-secret-for-tests-0123456789abcdef';
const NOW = 1_800_000_000_000;
const CHLOE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const INACTIVE = '33333333-3333-4333-8333-333333333333';
const CODE = '482913';

const tenants: Record<string, TenantMailConfig> = {
  [CHLOE]: { id: CHLOE, name: 'Chloe Food', active: true, logoUrl: 'https://cdn.example/chloe.png', color: '#c2410c', locale: 'fr-FR', locales: ['fr'], enabled: true, senderNameOverride: null, languageOverride: null },
  [OTHER]: { id: OTHER, name: 'Mama Spice', active: true, logoUrl: null, color: '#0f766e', locale: 'it-IT', locales: ['it', 'fr'], enabled: true, senderNameOverride: null, languageOverride: null },
  [INACTIVE]: { id: INACTIVE, name: 'Old Shop', active: false, logoUrl: null, color: null, locale: 'fr-FR', locales: ['fr'], enabled: true, senderNameOverride: null, languageOverride: null },
};

function setup(over: Partial<HandlerDeps> = {}) {
  const sent: OutgoingMail[] = [];
  const audits: AuditEntry[] = [];
  const transport: MailTransport = async (m) => { sent.push(m); return { ok: true, providerMessageId: `msg_${sent.length}` }; };
  const deps: HandlerDeps = {
    webhookSecret: WH_SECRET, contextSecret: CTX_SECRET, fromAddress: 'no-reply@auth.lepefy.com', otpExpiryMinutes: null,
    supabaseUrl: 'https://proj.supabase.co', nowMs: () => NOW, loadTenant: async (id) => tenants[id] ?? null,
    transport, audit: async (e) => { audits.push(e); }, ...over,
  };
  return { deps, sent, audits };
}

async function hookRequest(
  payload: unknown,
  opts: { id?: string; ts?: number; secret?: string; method?: string; tamper?: boolean } = {},
): Promise<Request> {
  const body = JSON.stringify(payload);
  const id = opts.id ?? 'msg_hook_1';
  const ts = String(opts.ts ?? Math.floor(NOW / 1000));
  const sig = await signWebhook(opts.secret ?? WH_SECRET, id, ts, body);
  return new Request('https://fn.example/auth-mailer', {
    method: opts.method ?? 'POST',
    headers: { 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig as string },
    body: opts.tamper ? body.replace(CODE, '000000') : body,
  });
}

async function otpPayload(o: { email?: string; tid?: string | null; kind?: 'customer' | 'admin' | 'platform' | 'deletion'; action?: string; ctxEmail?: string; now?: number; redirect?: string } = {}) {
  const email = o.email ?? 'client@example.com';
  const token = await issueContext(CTX_SECRET, { tid: o.tid === undefined ? CHLOE : o.tid, kind: o.kind ?? 'customer', email: o.ctxEmail ?? email, nowSeconds: o.now ?? Math.floor(NOW / 1000) });
  return {
    user: { id: 'u1', email },
    email_data: {
      token: CODE, token_hash: 'hash_hash_hash_01', redirect_to: o.redirect ?? withContext('https://shop.chloefood.com/', token),
      site_url: 'https://shop.chloefood.com', email_action_type: o.action ?? 'magiclink',
    },
  };
}

test.describe('Auth Mailer — OTP and branding', () => {
  test('Chloe Food: sender, subject, FR content, footer, no tracking', async () => {
    const { deps, sent, audits } = setup();
    const res = await handleAuthMailHook(await hookRequest(await otpPayload()), deps);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.from).toBe('"Chloe Food" <no-reply@auth.lepefy.com>');
    expect(m.subject).toBe('Ton code de connexion');
    expect(m.to).toBe('client@example.com');
    expect(m.html).toContain(CODE);
    expect(m.html).toContain('chloe.png');
    expect(m.html).toContain('Connexion sécurisée par Lepefy');
    expect(m.text).toContain(CODE);
    expect(m.html).not.toMatch(/<img[^>]+(width="1"|height="1")/);
    expect(audits[0]).toMatchObject({ outcome: 'accepted', tenantId: CHLOE, kind: 'customer', providerMessageId: 'msg_1' });
  });

  test('second tenant: its own name, language (IT), colour', async () => {
    const { deps, sent } = setup();
    const res = await handleAuthMailHook(await hookRequest(await otpPayload({ tid: OTHER })), deps);
    expect(res.status).toBe(200);
    expect(sent[0]!.from).toContain('Mama Spice');
    expect(sent[0]!.subject).toBe('Il tuo codice di accesso');
    expect(sent[0]!.html).toContain('#0f766e');
    expect(sent[0]!.html).not.toContain('Chloe');
  });

  test('same email on two tenants stays isolated, concurrently', async () => {
    const { deps, sent } = setup();
    const email = 'shared@example.com';
    const [a, b] = await Promise.all([
      handleAuthMailHook(await hookRequest(await otpPayload({ email, tid: CHLOE }), { id: 'h_a' }), deps),
      handleAuthMailHook(await hookRequest(await otpPayload({ email, tid: OTHER }), { id: 'h_b' }), deps),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const names = sent.map((m) => m.from).sort();
    expect(names).toEqual(['"Chloe Food" <no-reply@auth.lepefy.com>', '"Mama Spice" <no-reply@auth.lepefy.com>']);
    expect(sent.find((m) => m.from.includes('Chloe'))!.html).not.toContain('Mama Spice');
  });

  test('repeated OTP requests: two independent emails with different idempotency keys; Supabase retry reuses the key', async () => {
    const { deps, sent } = setup();
    await handleAuthMailHook(await hookRequest(await otpPayload(), { id: 'h_1' }), deps);
    await handleAuthMailHook(await hookRequest(await otpPayload(), { id: 'h_2' }), deps);
    await handleAuthMailHook(await hookRequest(await otpPayload(), { id: 'h_2' }), deps);
    expect(sent.map((m) => m.idempotencyKey)).toEqual(['auth-mail/h_1/primary', 'auth-mail/h_2/primary', 'auth-mail/h_2/primary']);
  });

  test('admin of a tenant uses the tenant name; platform owner uses Lepefy', async () => {
    const { deps, sent } = setup();
    await handleAuthMailHook(await hookRequest(await otpPayload({ kind: 'admin', tid: OTHER, email: 'a@x.com' })), deps);
    await handleAuthMailHook(await hookRequest(await otpPayload({ kind: 'platform', tid: null, email: 'p@x.com' }), { id: 'h_p' }), deps);
    expect(sent[0]!.from).toContain('Mama Spice');
    expect(sent[0]!.subject).toBe('Il tuo codice di accesso amministratore');
    expect(sent[1]!.subject).toBe('Ton code de connexion admin');
    expect(sent[1]!.from).toBe('"Lepefy" <no-reply@auth.lepefy.com>');
    expect(sent[1]!.html).toContain('Connexion sécurisée par Lepefy');
  });

  test('new and existing users produce the same email (signup / email / magiclink)', async () => {
    const { deps, sent } = setup();
    for (const [i, action] of (['signup', 'email', 'magiclink'] as const).entries()) {
      const res = await handleAuthMailHook(await hookRequest(await otpPayload({ action }), { id: `h_${i}` }), deps);
      expect(res.status).toBe(200);
    }
    expect(new Set(sent.map((m) => m.subject))).toEqual(new Set(['Ton code de connexion']));
  });

  test('account deletion and reauthentication get their own template', async () => {
    const { deps, sent } = setup();
    await handleAuthMailHook(await hookRequest(await otpPayload({ kind: 'deletion' })), deps);
    await handleAuthMailHook(await hookRequest(await otpPayload({ action: 'reauthentication' }), { id: 'h_r' }), deps);
    expect(sent[0]!.subject).toBe('Ton code pour supprimer ton compte');
    expect(sent[1]!.subject).toBe('Ton code de confirmation');
  });

  test('email change: secure mode sends two emails (current gets token, new gets token_new)', async () => {
    const { deps, sent } = setup();
    const token = await issueContext(CTX_SECRET, { tid: CHLOE, kind: 'customer', email: 'old@example.com', nowSeconds: Math.floor(NOW / 1000) });
    const payload = {
      user: { id: 'u1', email: 'old@example.com', new_email: 'new@example.com' },
      email_data: { token: '111111', token_new: '222222', token_hash: 'h_h_h_h_h_h_h_1', token_hash_new: 'h_h_h_h_h_h_h_2', redirect_to: withContext('https://shop.chloefood.com/', token), email_action_type: 'email_change' },
    };
    const res = await handleAuthMailHook(await hookRequest(payload), deps);
    expect(res.status).toBe(200);
    expect(sent.map((m) => [m.to, m.text.includes('111111'), m.text.includes('222222')])).toEqual([
      ['old@example.com', true, false], ['new@example.com', false, true],
    ]);
    expect(sent.map((m) => m.idempotencyKey)).toEqual(['auth-mail/msg_hook_1/current_address', 'auth-mail/msg_hook_1/new_address']);
  });

  test('email change: single mode sends one email to the new address', async () => {
    const { deps, sent } = setup();
    const token = await issueContext(CTX_SECRET, { tid: CHLOE, kind: 'customer', email: 'old@example.com', nowSeconds: Math.floor(NOW / 1000) });
    const payload = {
      user: { id: 'u1', email: 'old@example.com', new_email: 'new@example.com' },
      email_data: { token: '333333', token_hash: 'h_h_h_h_h_h_h_1', redirect_to: withContext('https://shop.chloefood.com/', token), email_action_type: 'email_change' },
    };
    await handleAuthMailHook(await hookRequest(payload), deps);
    expect(sent.map((m) => m.to)).toEqual(['new@example.com']);
  });

  test('recovery/invite use a link built on the project URL; notifications are acknowledged without sending', async () => {
    const { deps, sent, audits } = setup();
    const base = await otpPayload({ action: 'recovery' });
    await handleAuthMailHook(await hookRequest(base), deps);
    expect(sent[0]!.html).toContain('https://proj.supabase.co/auth/v1/verify?token=hash_hash_hash_01&amp;type=recovery');
    const notif = await otpPayload({ action: 'password_changed_notification' });
    const res = await handleAuthMailHook(await hookRequest(notif, { id: 'h_n' }), deps);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(audits.at(-1)!.outcome).toBe('skipped');
  });

  test('expiry is shown only when the real Auth value is configured', async () => {
    const off = setup();
    await handleAuthMailHook(await hookRequest(await otpPayload()), off.deps);
    expect(off.sent[0]!.text).not.toMatch(/expire/);
    const on = setup({ otpExpiryMinutes: 10 });
    await handleAuthMailHook(await hookRequest(await otpPayload()), on.deps);
    expect(on.sent[0]!.text).toContain('10 minutes');
  });
});

test.describe('Auth Mailer — fail closed', () => {
  async function expectRejected(payload: unknown, status: number, code: RegExp, opts: Parameters<typeof hookRequest>[1] = {}, over: Partial<HandlerDeps> = {}) {
    const { deps, sent, audits } = setup(over);
    const res = await handleAuthMailHook(await hookRequest(payload, opts), deps);
    expect(res.status).toBe(status);
    expect(JSON.stringify(await res.json())).toMatch(code);
    expect(sent).toHaveLength(0);
    return audits;
  }

  test('wrong method / invalid / tampered / expired webhook signature', async () => {
    const p = await otpPayload();
    await expectRejected(p, 405, /method_not_allowed/, { method: 'PUT' });
    await expectRejected(p, 401, /signature_bad_signature/, { secret: `v1,whsec_${bytesToBase64(new Uint8Array(32).fill(9))}` });
    await expectRejected(p, 401, /signature_bad_signature/, { tamper: true });
    await expectRejected(p, 401, /signature_timestamp_out_of_tolerance/, { ts: Math.floor(NOW / 1000) - 3600 });
    const audits = await expectRejected(p, 401, /signature/, { tamper: true });
    expect(audits).toHaveLength(0);
  });

  test('missing context, tampered context, expired context, wrong recipient', async () => {
    const good = await otpPayload();
    const noCtx = { ...good, email_data: { ...good.email_data, redirect_to: 'https://shop.chloefood.com/' } };
    await expectRejected(noCtx, 403, /context_missing/);

    const parts = contextFromRedirect(good.email_data.redirect_to)!.split('.');
    const claims = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString());
    claims.tid = OTHER;
    const forged = `${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${parts[1]}`;
    await expectRejected({ ...good, email_data: { ...good.email_data, redirect_to: withContext('https://shop.chloefood.com/', forged) } }, 403, /context_bad_signature/);

    await expectRejected(await otpPayload({ now: Math.floor(NOW / 1000) - 3600 }), 403, /context_expired/);
    await expectRejected(await otpPayload({ ctxEmail: 'someone-else@example.com' }), 403, /context_email_mismatch/);
  });

  test('unknown or inactive tenant, disabled settings', async () => {
    await expectRejected(await otpPayload({ tid: '44444444-4444-4444-8444-444444444444' }), 403, /tenant_not_found/);
    await expectRejected(await otpPayload({ tid: INACTIVE }), 403, /tenant_inactive/);
    await expectRejected(await otpPayload(), 403, /tenant_mail_disabled/, {}, { loadTenant: async () => ({ ...tenants[CHLOE]!, enabled: false }) });
  });

  test('invalid payload and unknown action are rejected', async () => {
    await expectRejected({ foo: 1 }, 400, /payload_/);
    const bad = await otpPayload({ action: 'weird_action' });
    await expectRejected(bad, 400, /payload_unknown_action/);
  });

  test('provider failure and timeout return an error to Supabase (no false success)', async () => {
    const failing = setup({ transport: async () => ({ ok: false, code: 'provider_http_503', retryable: true }) });
    const res = await handleAuthMailHook(await hookRequest(await otpPayload()), failing.deps);
    expect(res.status).toBe(502);
    expect(failing.audits[0]).toMatchObject({ outcome: 'failed', errorCode: 'provider_http_503' });

    const slowFetch = ((_u: string, init: RequestInit) => new Promise((_r, rej) => {
      init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch;
    const out = await createResendTransport('re_x', slowFetch, 20)({ from: 'a', to: 'b', subject: 's', html: 'h', text: 't', idempotencyKey: 'k' });
    expect(out).toEqual({ ok: false, code: 'provider_timeout', retryable: true });
  });

  test('Resend adapter: sends idempotency key, requires a message id', async () => {
    let seen: { headers: Record<string, string>; body: string } | null = null;
    const ok = (async (_u: string, init: RequestInit) => {
      seen = { headers: init.headers as Record<string, string>, body: init.body as string };
      return new Response(JSON.stringify({ id: 're_123' }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await createResendTransport('re_key', ok)({ from: 'f', to: 't@x.com', subject: 's', html: 'h', text: 't', idempotencyKey: 'auth-mail/x/primary' });
    expect(r).toEqual({ ok: true, providerMessageId: 're_123' });
    expect(seen!.headers['Idempotency-Key']).toBe('auth-mail/x/primary');
    const noId = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    expect((await createResendTransport('k', noId)({ from: 'f', to: 't', subject: 's', html: 'h', text: 't', idempotencyKey: 'k' })).ok).toBe(false);
  });

  test('audit rows never carry the code, address or link', async () => {
    const { deps, audits } = setup();
    await handleAuthMailHook(await hookRequest(await otpPayload()), deps);
    const dump = JSON.stringify(audits);
    expect(dump).not.toContain(CODE);
    expect(dump).not.toContain('client@example.com');
    expect(dump).not.toContain('hash_hash');
  });
});

test.describe('Auth Mailer — admin identity', () => {
  const deps = (deployment: string | null, access: boolean) => ({
    deploymentTenantId: async () => deployment,
    hasTenantAccess: async () => access,
  });
  test('admin logging in on a tenant deployment gets that tenant when a membership exists', async () => {
    // legacy row says Lepefy Test, membership grants Chloe Food (the PlatformTest case)
    const r = await resolveAdminMailIdentity({ id: 'u', role: 'tenant_admin', tenant_id: OTHER }, deps(CHLOE, true));
    expect(r).toEqual({ tenantId: CHLOE, kind: 'admin' });
  });
  test('no access to the deployment tenant falls back to the legacy row; platform owner stays Lepefy', async () => {
    expect(await resolveAdminMailIdentity({ id: 'u', role: 'tenant_admin', tenant_id: OTHER }, deps(CHLOE, false))).toEqual({ tenantId: OTHER, kind: 'admin' });
    expect(await resolveAdminMailIdentity({ id: 'u', role: 'platform_owner', tenant_id: null }, deps(CHLOE, true))).toEqual({ tenantId: null, kind: 'platform' });
    expect(await resolveAdminMailIdentity({ id: 'u', role: 'tenant_admin', tenant_id: null }, { deploymentTenantId: async () => { throw new Error('x'); }, hasTenantAccess: async () => true })).toEqual({ tenantId: null, kind: 'platform' });
  });
});

test.describe('Auth Mailer — units', () => {
  test('sender name sanitisation and fixed domain', () => {
    expect(sanitizeSenderName('Chloe Food')).toBe('Chloe Food');
    expect(sanitizeSenderName('Evil\r\nBcc: x@y.com')).not.toMatch(/[\r\n@<>]/);
    expect(sanitizeSenderName('support@paypal.com')).toBe('Lepefy');
    expect(sanitizeSenderName('https://phish.io')).toBe('Lepefy');
    expect(sanitizeSenderName('A'.repeat(200)).length).toBeLessThanOrEqual(60);
    expect(sanitizeSenderName(null)).toBe('Lepefy');
    expect(resolveFromAddress('attacker@evil.com')).toBe('no-reply@auth.lepefy.com');
    expect(resolveFromAddress('hello@auth.lepefy.com')).toBe('hello@auth.lepefy.com');
    expect(formatFrom('Chloe Food', 'no-reply@auth.lepefy.com')).toBe('"Chloe Food" <no-reply@auth.lepefy.com>');
  });

  test('templates: all languages, escaping, https-only logo, safe colour', () => {
    for (const language of ['fr', 'it', 'en'] as const) {
      const r = renderAuthEmail({ purpose: 'login', language, brand: { name: 'Shop', logoUrl: null, color: '#112233' }, code: '123456' });
      expect(r.html).toContain('123456');
      expect(r.html).toContain(`lang="${language}"`);
    }
    const r = renderAuthEmail({
      purpose: 'login', language: 'fr',
      brand: { name: '<script>x</script>', logoUrl: 'http://insecure/logo.png', color: 'red;background:url(x)' }, code: '123456',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).not.toContain('insecure');
    expect(r.html).not.toContain('url(x)');
  });

  test('context: signature, expiry and binding', async () => {
    const now = 1_800_000_000;
    const t = await issueContext(CTX_SECRET, { tid: CHLOE, kind: 'customer', email: ' Client@Example.com ', nowSeconds: now });
    expect((await verifyContext(CTX_SECRET, t, ['client@example.com'], now + 5)).ok).toBe(true);
    expect(await verifyContext('other-secret', t, ['client@example.com'], now)).toMatchObject({ ok: false, reason: 'bad_signature' });
    expect(await verifyContext(CTX_SECRET, t, ['client@example.com'], now + 700)).toMatchObject({ ok: false, reason: 'expired' });
    expect(await verifyContext(CTX_SECRET, 'garbage', ['x@y.z'], now)).toMatchObject({ ok: false });
    const platformBad = await issueContext(CTX_SECRET, { tid: null, kind: 'customer', email: 'a@b.co', nowSeconds: now });
    expect(await verifyContext(CTX_SECRET, platformBad, ['a@b.co'], now)).toMatchObject({ ok: false, reason: 'invalid_claims' });
  });

  test('storefront issuer is inert unless explicitly enabled, then yields a verifiable redirect', async () => {
    expect(await authMailRedirectOptions({ tenantId: CHLOE, kind: 'customer', email: 'a@b.co' }, {} as NodeJS.ProcessEnv)).toEqual({});
    const env = { AUTH_MAILER_CONTEXT_ENABLED: '1', AUTH_MAILER_CONTEXT_SECRET: CTX_SECRET, NEXT_PUBLIC_APP_URL: 'https://shop.chloefood.com' } as unknown as NodeJS.ProcessEnv;
    const { emailRedirectTo } = await authMailRedirectOptions({ tenantId: CHLOE, kind: 'customer', email: 'a@b.co' }, env);
    const v = await verifyContext(CTX_SECRET, contextFromRedirect(emailRedirectTo), ['a@b.co'], Math.floor(Date.now() / 1000));
    expect(v).toMatchObject({ ok: true });
  });

  test('Edge Function copy is in sync with the tested core', () => {
    const src = join(__dirname, '../../src/lib/authMailer/core');
    const dest = join(__dirname, '../../../../supabase/functions/_shared/authMailer');
    for (const f of readdirSync(src).filter((n) => n.endsWith('.ts'))) {
      const expected = '// GENERATED by apps/storefront/scripts/syncAuthMailer.mjs from src/lib/authMailer/core. Do not edit.\n'
        + readFileSync(join(src, f), 'utf8').replace(/(from\s+')(\.\/[\w-]+)(')/g, '$1$2.ts$3');
      expect(readFileSync(join(dest, f), 'utf8'), `${f} stale: run node scripts/syncAuthMailer.mjs`).toBe(expected);
    }
  });

  test('hook function never logs secrets', () => {
    const fn = readFileSync(join(__dirname, '../../../../supabase/functions/auth-mailer/index.ts'), 'utf8');
    expect(fn).not.toMatch(/console\.(log|info|error|warn)/);
  });
});
