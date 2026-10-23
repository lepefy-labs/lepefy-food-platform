import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { demoKeyMismatch, isDemoActive, isDemoDeployment, isStripeTestKey } from '../../src/lib/demo/demoEnvironment';
import { createDemoAccessToken, verifyDemoAccessToken } from '../../src/lib/demo/accessToken';
import { DEMO_VISITOR_PERMISSIONS } from '../../src/lib/demo/visitorPermissions';
import { draftFromNotification, htmlToPreview, maskRecipient } from '../../src/lib/demo/simulatedMessageFormat';
import { validateDemoRequest } from '../../src/lib/demo/demoRequest';
import { DEMO_PATHS, DEMO_SERVICE_SLUGS, parseTourState } from '../../src/lib/demo/tours';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';
import { sendNotification } from '../../src/lib/events/notifyN8n';
import { sendViaBrevo } from '../../src/lib/notifications/emailTransport';
import { sendGreenApiText } from '../../src/lib/notifications/providers/greenApiOutbound';
import { getStripeSecretKey } from '../../src/lib/payments/stripeServerConfig';
import { resolvePacklinkApiKey } from '../../src/lib/shipping/packlinkApiKey';

const ROOT = join(__dirname, '../../../..');
const SRC = join(__dirname, '../../src');
const SECRET = 'x'.repeat(40);

async function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { await fn(); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

/** fetch qui échoue le test si quelqu'un appelle l'extérieur. */
async function withoutNetwork(fn: () => Promise<void>) {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => { calls.push(String(input)); throw new Error('network blocked in test'); }) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = original; }
  return calls;
}

test.describe('demo keys', () => {
  test('demo features need both the deployment and the tenant; one key alone is a mismatch', () => {
    const demoTenant = { is_demo: true, is_test: true };
    const realTenant = { is_demo: false, is_test: false };
    expect(isDemoActive(demoTenant, { LEPEFY_DEPLOYMENT_KIND: 'demo' })).toBe(true);
    expect(isDemoActive(demoTenant, {})).toBe(false);
    expect(isDemoActive(realTenant, { LEPEFY_DEPLOYMENT_KIND: 'demo' })).toBe(false);
    expect(isDemoActive({ is_demo: true, is_test: false }, { LEPEFY_DEPLOYMENT_KIND: 'demo' })).toBe(false);
    expect(demoKeyMismatch(realTenant, { LEPEFY_DEPLOYMENT_KIND: 'demo' })).toBe(true);
    expect(demoKeyMismatch(demoTenant, {})).toBe(true);
    expect(demoKeyMismatch(realTenant, {})).toBe(false);
    expect(isDemoDeployment({ LEPEFY_DEPLOYMENT_KIND: 'production' })).toBe(false);
  });

  test('only Stripe test keys are accepted', () => {
    expect(isStripeTestKey('sk_test_123')).toBe(true);
    expect(isStripeTestKey('rk_test_123')).toBe(true);
    expect(isStripeTestKey('sk_live_123')).toBe(false);
    expect(isStripeTestKey(undefined)).toBe(false);
  });
});

test.describe('demo outbound guards (nothing real leaves a demo deployment)', () => {
  test('a live Stripe key is refused on the demo, a test key is used', async () => {
    await withEnv({ LEPEFY_DEPLOYMENT_KIND: 'demo', STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_SECRET_KEY_SHOP: undefined }, () => {
      expect(() => getStripeSecretKey('shop')).toThrow(/clé Stripe live refusée/);
    });
    await withEnv({ LEPEFY_DEPLOYMENT_KIND: 'demo', STRIPE_SECRET_KEY: 'sk_test_abc', STRIPE_SECRET_KEY_SHOP: undefined }, () => {
      expect(getStripeSecretKey('shop')).toBe('sk_test_abc');
    });
    await withEnv({ LEPEFY_DEPLOYMENT_KIND: undefined, STRIPE_SECRET_KEY: 'sk_live_abc', STRIPE_SECRET_KEY_SHOP: undefined }, () => {
      expect(getStripeSecretKey('shop')).toBe('sk_live_abc');
    });
  });

  test('notifications and e-mails are kept as simulated messages, never sent', async () => {
    await withEnv({ LEPEFY_DEPLOYMENT_KIND: 'demo', N8N_WEBHOOK_URL: 'https://n8n.example', EMAIL_TRANSPORT: 'brevo', BREVO_API_KEY: 'key', NEXT_PUBLIC_SUPABASE_URL: undefined }, async () => {
      const calls = await withoutNetwork(async () => {
        const email = await sendNotification('/webhook/send-email', { recipients: ['client@example.com'], subject: 'Commande confirmée', html: '<p>Merci</p>' });
        expect(email).toMatchObject({ ok: true, skipped: true });
        const webhook = await sendNotification('/webhook/order-confirmed', { customerEmail: 'client@example.com' });
        expect(webhook).toMatchObject({ ok: true, skipped: true });
        expect(await sendViaBrevo({ recipients: ['a@example.com'], subject: 'x', html: '<p>x</p>' })).toMatchObject({ ok: true, skipped: true });
      });
      expect(calls.filter((url) => !url.includes('/rest/v1/'))).toEqual([]);
    });
  });

  test('WhatsApp (Green API) and Packlink are blocked on the demo', async () => {
    await withEnv({ LEPEFY_DEPLOYMENT_KIND: 'demo', PACKLINK_API_KEY: 'platform-key' }, async () => {
      const calls = await withoutNetwork(async () => {
        const result = await sendGreenApiText({ apiUrl: 'https://api.green-api.example', instanceId: '1', token: 't' } as never, { phone: '+33639980001', message: 'Bonjour' });
        expect(result).toMatchObject({ ok: false, definitive: true, error: 'demo_blocked' });
      });
      expect(calls).toEqual([]);
      expect(resolvePacklinkApiKey({ packlink_api_key: 'tenant-key', is_test: true })).toBeNull();
    });
  });
});

test.describe('demo visitor role', () => {
  test('SQL role and code list are the same read-only capabilities', () => {
    const sql = readFileSync(join(ROOT, 'supabase/migrations/167_demo_experience.sql'), 'utf8');
    const block = sql.slice(sql.indexOf("join public.admin_permissions p on p.key in ("), sql.indexOf("where r.code = 'demo_visitor'"));
    const keys = [...block.matchAll(/'([a-z_.]+)'/g)].map((match) => match[1]).sort();
    expect(keys).toEqual([...DEMO_VISITOR_PERMISSIONS].sort());
    for (const permission of DEMO_VISITOR_PERMISSIONS) {
      expect(permission.endsWith('.view'), permission).toBe(true);
      expect(permission.startsWith('platform.'), permission).toBe(false);
      expect(['audit.view', 'tenant_settings.view', 'billing.view', 'whatsapp.view']).not.toContain(permission);
    }
  });

  // POST en lecture seule (calcul sans écriture ni appel externe), vérifiés à la main.
  const READ_ONLY_POSTS = new Set(['/api/admin/shipping-advisor']);

  test('no admin API write route is reachable with a visitor capability', () => {
    const visitor = new Set<string>(DEMO_VISITOR_PERMISSIONS);
    const apiRoot = join(SRC, 'app/api/admin');
    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === 'route.ts') routes.push(full);
      }
    };
    walk(apiRoot);
    expect(routes.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of routes) {
      const source = readFileSync(file, 'utf8');
      const path = '/api/admin/' + relative(apiRoot, file).split(sep).slice(0, -1).join('/')
        .replace(/\[[^\]]+\]/g, '00000000-0000-4000-8000-000000000001');
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        if (!new RegExp(`export (async )?function ${method}\\b|export const ${method}\\b`).test(source)) continue;
        const permission = permissionForAdminApi(path.replace(/\/$/, ''), method);
        if (READ_ONLY_POSTS.has(path)) continue;
        if (permission && visitor.has(permission)) offenders.push(`${method} ${path} → ${permission}`);
        // Garde explicite d'une capability de lecture dans un fichier qui écrit : à vérifier à la main.
        for (const match of source.matchAll(/requirePermission\([^,]+,\s*'([a-z_.]+)'\)/g)) {
          if (match[1] && visitor.has(match[1]) && !/export (async )?function GET\b/.test(source)) offenders.push(`${method} ${path} guarded by ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every admin step of the guided tour opens with visitor capabilities', () => {
    for (const path of DEMO_PATHS.filter((entry) => entry.admin)) {
      for (const step of path.steps) {
        if (!step.href) continue;
        const required = permissionsForAdminPath(step.href.split('?')[0] ?? step.href, 'shop');
        expect(required, step.href).not.toBeNull();
        expect(required!.some((permission) => (DEMO_VISITOR_PERMISSIONS as readonly string[]).includes(permission)), step.href).toBe(true);
      }
    }
  });
});

test.describe('demo access link', () => {
  test('signed, expiring, tamper-proof', () => {
    const now = new Date('2026-10-23T10:00:00Z');
    const token = createDemoAccessToken(SECRET, 'tata-pao', new Date('2026-10-30T10:00:00Z'));
    expect(verifyDemoAccessToken(SECRET, token, now)?.label).toBe('tata-pao');
    expect(verifyDemoAccessToken(SECRET, token, new Date('2026-10-31T00:00:00Z'))).toBeNull();
    expect(verifyDemoAccessToken('y'.repeat(40), token, now)).toBeNull();
    expect(verifyDemoAccessToken(SECRET, token.replace('tata-pao', 'autre'), now)).toBeNull();
    expect(verifyDemoAccessToken(SECRET, `${token}.x`, now)).toBeNull();
    expect(verifyDemoAccessToken(undefined, token, now)).toBeNull();
    expect(() => createDemoAccessToken('short', 'tata-pao', now)).toThrow();
  });
});

test.describe('simulated messages', () => {
  test('recipients are masked and HTML reduced to text', () => {
    expect(maskRecipient('awa.diop@example.com')).toBe('a***@example.com');
    expect(maskRecipient('+33 6 39 98 00 12')).toBe('+336…12');
    expect(maskRecipient(null)).toBeNull();
    expect(htmlToPreview('<style>p{}</style><p>Bonjour&nbsp;Awa</p><p>Merci</p>')).toBe('Bonjour Awa\nMerci');
    const draft = draftFromNotification('/webhook/send-email', { recipients: ['awa@example.com'], subject: 'Commande', html: '<b>OK</b>', notificationType: 'order_confirmed' });
    expect(draft).toEqual({ channel: 'email', kind: 'order_confirmed', recipientHint: 'a***@example.com', subject: 'Commande', preview: 'OK' });
  });
});

test.describe('demo request form', () => {
  const base = { businessName: 'Traiteur Test', email: 'contact@example.com', consent: true };
  test('needs a name, one contact and explicit consent', () => {
    expect(validateDemoRequest(base)).toMatchObject({ ok: true });
    expect(validateDemoRequest({ ...base, consent: false })).toMatchObject({ ok: false, field: 'consent' });
    expect(validateDemoRequest({ ...base, email: null })).toMatchObject({ ok: false, field: 'contact' });
    expect(validateDemoRequest({ ...base, email: 'pas-un-email' })).toMatchObject({ ok: false, field: 'email' });
    expect(validateDemoRequest({ ...base, businessName: ' ' })).toMatchObject({ ok: false, field: 'businessName' });
    const ok = validateDemoRequest({ ...base, interests: ['events', 'nope', 'events'] });
    expect(ok.ok && ok.value.interests).toEqual(['events']);
  });
});

test.describe('guided tour', () => {
  test('five paths, admin paths flagged, state parsing is defensive', () => {
    expect(DEMO_PATHS.map((path) => path.key)).toEqual(['shop', 'events', 'orders', 'management', 'nala']);
    expect(DEMO_PATHS.filter((path) => path.admin).map((path) => path.key)).toEqual(['orders', 'management']);
    expect(parseTourState(JSON.stringify({ path: 'shop', step: 1 }))).toEqual({ path: 'shop', step: 1, minimized: false });
    expect(parseTourState(JSON.stringify({ path: 'shop', step: 99 }))).toBeNull();
    expect(parseTourState('{oops')).toBeNull();
    expect(parseTourState(JSON.stringify({ path: 'admin', step: 0 }))).toBeNull();
  });
});

test.describe('demo seed', () => {
  const load = (path: string) => import(pathToFileURL(join(ROOT, 'scripts/demo', path)).href);

  test('the plan is deterministic, consistent and uses fictitious identities only', async () => {
    const { buildPlan } = await load('lib/buildPlan.mjs');
    const { validatePlan } = await load('lib/validatePlan.mjs');
    const { scenario } = await load('scenarios/traiteur-africain.mjs');
    const options = { tenantId: '10000000-0000-4000-8000-000000000001', anchor: new Date('2026-10-23T08:00:00Z'), appUrl: 'https://demo.example' };
    const plan = buildPlan(scenario, options);
    expect(validatePlan(scenario, plan)).toEqual([]);
    expect(JSON.stringify(buildPlan(scenario, options).tables)).toBe(JSON.stringify(plan.tables));
    const rows = (table: string) => plan.tables.find((entry: { table: string }) => entry.table === table)?.rows ?? [];
    expect(rows('products')).toHaveLength(60);
    expect(rows('customers')).toHaveLength(45);
    expect(rows('orders')).toHaveLength(120);
    expect(rows('service_offerings').map((row: { slug: string }) => row.slug).sort()).toEqual([DEMO_SERVICE_SLUGS.rental, DEMO_SERVICE_SLUGS.catering].sort());
    expect(rows('orders').every((row: { is_test: boolean }) => row.is_test)).toBe(true);
    // Rien qui ressemble à un vrai moyen de contact : e-mails @example.com, téléphones de fiction ARCEP.
    const text = JSON.stringify(plan.tables);
    for (const email of text.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []) expect(email.endsWith('example.com') || email === 'demo@lepefy.com', email).toBe(true);
    for (const phone of text.match(/\+33 \d[\d ]{8,}/g) ?? []) expect(phone.startsWith('+33 6 39 98'), phone).toBe(true);
    // Un autre tenant (remise à zéro) obtient d'autres identifiants.
    const other = buildPlan(scenario, { ...options, tenantId: '10000000-0000-4000-8000-000000000002' });
    expect(other.tables[4].rows[0].id).not.toBe(plan.tables[4].rows[0].id);
  });

  test('the private scenario keeps the same data and is refused on a public demo', async () => {
    const { scenario: base } = await load('scenarios/traiteur-africain.mjs');
    const { scenario: privateScenario } = await load('scenarios/tata-pao.mjs');
    expect(privateScenario.requiresPrivate).toBe(true);
    expect(base.requiresPrivate).toBe(false);
    expect(privateScenario.products).toBe(base.products);
    expect(base.tenant.name).not.toMatch(/tata/i);
    expect(JSON.stringify(base)).not.toMatch(/tata pao/i);
  });

  test('the seed refuses any database that is not the demo project', async () => {
    const { assertDemoProject } = await load('seed-demo.mjs');
    expect(() => assertDemoProject('https://abcdefghijklmnop.supabase.co', 'abcdefghijklmnop')).not.toThrow();
    expect(() => assertDemoProject('https://productionref1234.supabase.co', 'abcdefghijklmnop')).toThrow(/refusé/);
    expect(() => assertDemoProject('https://abcdefghijklmnop.supabase.co', undefined)).toThrow();
  });

  test('the demo schema replays every migration, with drift patches on existing files', async () => {
    const { buildDemoSchemaSql, DRIFT_PATCHES, migrationFiles } = await load('build-demo-schema.mjs');
    const files: string[] = migrationFiles();
    const sql: string = buildDemoSchemaSql();
    for (const file of files) expect(sql).toContain(`-- ═══ ${file}`);
    for (const file of Object.keys(DRIFT_PATCHES)) expect(files).toContain(file);
    expect(sql.indexOf('Amorçage du schéma démo')).toBeGreaterThan(sql.indexOf('-- ═══ 001_initial_schema.sql'));
    expect(sql).toMatch(/delete from public\.tenants where slug = 'chloefood' and active = false/);
  });
});
