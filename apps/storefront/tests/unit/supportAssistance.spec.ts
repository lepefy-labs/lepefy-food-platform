import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  SUPPORT_CATEGORIES, SUPPORT_FLAG, SUPPORT_LIMITS, SUPPORT_STATUSES, isSupportManualChannel, supportReference, type SupportStatus,
} from '../../src/lib/support/domain';
import {
  SUPPORT_TRANSITIONS, buildSupportContext, canTransition, cleanMessageBody, deriveTitle, deviceFromUserAgent, isMeaningfulText,
  notificationWindow, pageLabelForPath, parseGithubLink, reopenTarget, resourceFromPath, routePattern, sanitizeAdminPathname,
  suggestionKeepsFacts, tenantStatus,
} from '../../src/lib/support/rules';
import { checkSupportImage, imageDimensions, sniffSupportImage } from '../../src/lib/support/files';
import { SUPPORT_ERRORS, supportErrorCode } from '../../src/lib/support/errors';
import { SUPPORT_LIST } from '../../src/lib/support/platformList';
import { SUPPORT_PRIORITY_META, SUPPORT_STATUS_META, SUPPORT_TENANT_STATUS_META } from '../../src/lib/admin/statusRegistry';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { featureFlagDefinition } from '../../src/lib/featureFlags/featureFlagRegistry';
import { availableNotificationTypes, notificationTypeContext } from '../../src/lib/notifications/notificationTypes';
import { AUDIT_MODULES } from '../../src/lib/audit/eventCatalog';
import { resolveJournalScope } from '../../src/lib/audit/scope';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(ROOT, '../../supabase/migrations/163_support_assistance.sql'), 'utf8');
const ID = '0f8c2b36-5a3d-4c41-9f2e-6c1b8c0a1d11';

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

// ─── Workflow: TS mirror of the SQL rules ────────────────────────────────────

test('transitions match SQL support_transition_allowed exactly', () => {
  const body = MIGRATION.slice(MIGRATION.indexOf('function public.support_transition_allowed'), MIGRATION.indexOf('-- Captures « en attente »'));
  for (const from of SUPPORT_STATUSES) {
    const line = new RegExp(`when '${from}'\\s+then p_to in \\(([^)]*)\\)`).exec(body);
    expect(line, from).not.toBeNull();
    const sql = [...line![1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort();
    expect([...SUPPORT_TRANSITIONS[from]].sort(), from).toEqual(sql);
  }
  expect(canTransition('new', 'new')).toBe(false);
  expect(canTransition('closed', 'resolved')).toBe(false);
  expect(canTransition('resolved', 'in_progress')).toBe(true);
});

test('the shop never sees an internal status (SQL support_tenant_status)', () => {
  const expected: Record<SupportStatus, string> = {
    new: 'sent', triaged: 'in_progress', planned: 'in_progress', in_progress: 'in_progress',
    waiting_tenant: 'waiting_you', resolved: 'done', closed: 'done',
  };
  for (const status of SUPPORT_STATUSES) expect(tenantStatus(status)).toBe(expected[status]);
  expect(MIGRATION).toContain("when p_status in ('triaged', 'planned', 'in_progress') then 'in_progress'");
  expect(Object.keys(SUPPORT_TENANT_STATUS_META).sort()).toEqual(['done', 'in_progress', 'sent', 'waiting_you']);
  expect(SUPPORT_TENANT_STATUS_META.sent?.label).toBe('Envoyée');
  expect(SUPPORT_TENANT_STATUS_META.waiting_you?.label).toBe('Nous attendons votre réponse');
  expect(SUPPORT_TENANT_STATUS_META.done?.label).toBe('Terminée');
  for (const status of SUPPORT_STATUSES) expect(SUPPORT_STATUS_META[status], status).toBeDefined();
  expect(Object.keys(SUPPORT_PRIORITY_META)).toEqual(['low', 'normal', 'high', 'critical']);
  expect(reopenTarget('resolved')).toBe('in_progress');
  expect(reopenTarget('closed')).toBe('triaged');
  expect(reopenTarget('new')).toBeNull();
});

test('enums of the code match the SQL CHECK constraints', () => {
  expect(MIGRATION).toContain(`status in (${SUPPORT_STATUSES.map((s) => `'${s}'`).join(', ')})`);
  expect(MIGRATION).toContain(`category in (${SUPPORT_CATEGORIES.map((s) => `'${s}'`).join(', ')})`);
  expect(MIGRATION).toContain(`size_bytes <= ${SUPPORT_LIMITS.attachmentBytes}`);
  expect(MIGRATION).toContain(`char_length(btrim(body)) between 1 and ${SUPPORT_LIMITS.bodyMax}`);
  expect(MIGRATION).toContain(`cardinality(v_ids) > ${SUPPORT_LIMITS.attachmentsPerMessage}`);
});

// ─── Text ────────────────────────────────────────────────────────────────────

test('message text: control characters dropped, HTML kept as plain text, blank runs shortened', () => {
  expect(cleanMessageBody('  Bonjour\r\n\r\n\r\n\r\n\r\nça bloque\u0000‮  ')).toBe('Bonjour\n\n\nça bloque');
  // Never interpreted: rendered as text by React (no dangerouslySetInnerHTML in the module).
  expect(cleanMessageBody('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  expect(cleanMessageBody(42)).toBe('');
  expect(isMeaningfulText('?!…')).toBe(false);
  expect(isMeaningfulText('Ça bug')).toBe(true);
});

test('derived title: first sentence, chat prefixes removed, cut on a word', () => {
  expect(deriveTitle('Le bouton imprimer ne fait rien. Depuis ce matin sur la commande 1042.')).toBe('Le bouton imprimer ne fait rien');
  expect(deriveTitle('[14/10/2026 18:32] Chloé : les frais de port affichent 0 € pour la Belgique')).toBe('les frais de port affichent 0 € pour la Belgique');
  expect(deriveTitle('14/10/2026, 18:32 - Chloé: bonjour, problème avec les étiquettes')).toBe('bonjour, problème avec les étiquettes');
  const long = deriveTitle('Je voudrais pouvoir ajouter le poids net et le poids brut sur les étiquettes des produits frais et surgelés de la boutique');
  expect(long.length).toBeLessThanOrEqual(80);
  expect(long.endsWith('…')).toBe(true);
  expect(deriveTitle('   ')).toBe('Demande d’assistance');
});

test('AI suggestion must keep every number and add none', () => {
  expect(suggestionKeepsFacts('Commande 1042 bloquée à 12,50 €', 'La commande 1042 est bloquée (12,50 €).')).toBe(true);
  expect(suggestionKeepsFacts('Commande 1042 bloquée', 'La commande 1043 est bloquée.')).toBe(false);
  expect(suggestionKeepsFacts('Le bouton ne marche pas', 'Le bouton ne marche pas depuis 3 jours.')).toBe(false);
});

// ─── Context: only what is needed ────────────────────────────────────────────

test('pathname: admin only, no query string or hash, ids masked in the route', () => {
  expect(sanitizeAdminPathname('/admin/orders?token=abc#x')).toBe('/admin/orders');
  expect(sanitizeAdminPathname('https://evil.example/admin')).toBeNull();
  expect(sanitizeAdminPathname('/admin/../api/admin/team')).toBeNull();
  expect(sanitizeAdminPathname('/products/x')).toBeNull();
  expect(sanitizeAdminPathname(`/admin/orders/${ID}/`)).toBe(`/admin/orders/${ID}`);
  expect(routePattern(`/admin/orders/${ID}`)).toBe('/admin/orders/[id]');
});

test('page label from the navigation registry; resource only from a detail page', () => {
  expect(pageLabelForPath('/admin')).toBe('Aujourd’hui');
  expect(pageLabelForPath('/admin/orders')).toBe('Commandes');
  expect(pageLabelForPath(`/admin/orders/${ID}`)).toBe('Commandes');
  expect(pageLabelForPath('/admin/orders/preparation')).toBe('Session de préparation');
  expect(pageLabelForPath('/admin/catalogue/categories')).toBe('Catégories');
  expect(pageLabelForPath('/admin/inconnue')).toBe('Administration');
  expect(resourceFromPath(`/admin/orders/${ID}`)).toEqual({ type: 'order', id: ID });
  expect(resourceFromPath(`/admin/catalogue/${ID}`)).toEqual({ type: 'product', id: ID });
  expect(resourceFromPath(`/admin/clients/${ID}`)).toEqual({ type: 'customer', id: ID });
  expect(resourceFromPath('/admin/orders/preparation')).toBeNull();
});

test('context keeps page, route, language, device and build — never the raw user agent or the query', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const context = buildSupportContext({ pathname: `/admin/orders/${ID}`, locale: 'fr-FR', userAgent: iphone, appVersion: 'a87e2d0e1234', viewport: '390x844' });
  expect(context).toEqual({ route: '/admin/orders/[id]', page_label: 'Commandes', locale: 'fr-FR', device: 'mobile', os: 'iOS', browser: 'Safari', app_version: 'a87e2d0', viewport: '390x844' });
  expect(JSON.stringify(context)).not.toContain('Mozilla');
  expect(JSON.stringify(context)).not.toContain(ID);
  expect(buildSupportContext({ pathname: null, locale: '<script>', viewport: '9999999x1', appVersion: 'not-a-sha' })).toEqual({ device: 'desktop', os: 'Autre', browser: 'Autre' });
  expect(deviceFromUserAgent('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/126.0 Safari/537.36').device).toBe('tablet');
  expect(deviceFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0')).toEqual({ device: 'desktop', os: 'Windows', browser: 'Edge' });
});

// ─── GitHub links, notifications, references ─────────────────────────────────

test('GitHub links: only verified issue / PR / commit / release URLs (same rule as the SQL CHECK)', () => {
  expect(parseGithubLink('https://github.com/lepefy-labs/lepefy-food-platform/pull/821?x=1')).toEqual({ url: 'https://github.com/lepefy-labs/lepefy-food-platform/pull/821', kind: 'pull_request', label: 'lepefy-food-platform PR #821' });
  expect(parseGithubLink('https://github.com/a/b/issues/12')?.kind).toBe('issue');
  expect(parseGithubLink('https://github.com/a/b/commit/a87e2d0e')?.label).toBe('b@a87e2d0');
  expect(parseGithubLink('https://github.com/a/b/releases/tag/v1.2.0')?.kind).toBe('release');
  for (const bad of ['http://github.com/a/b/pull/1', 'https://github.com.evil.io/a/b/pull/1', 'https://github.com/a/b/pull/x', 'javascript:alert(1)', 'https://github.com/a/b']) {
    expect(parseGithubLink(bad), bad).toBeNull();
  }
  expect(MIGRATION).toContain("url ~ '^https://github\\.com/");
});

test('notification window: replies in a burst share one key, the next window gets a new one', () => {
  const base = new Date('2026-10-22T10:00:00Z');
  expect(notificationWindow(new Date(base.getTime() + 5 * 60_000))).toBe(notificationWindow(new Date(base.getTime() + 14 * 60_000)));
  expect(notificationWindow(new Date(base.getTime() + 16 * 60_000))).not.toBe(notificationWindow(base));
  expect(supportReference(1042)).toBe('n° 1042');
});

// ─── Files: real type from the bytes ─────────────────────────────────────────

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

test('screenshots: type from the bytes, size from the header, forged files refused', () => {
  expect(sniffSupportImage(png(1170, 2532))).toBe('image/png');
  expect(imageDimensions(png(1170, 2532), 'image/png')).toEqual({ width: 1170, height: 2532 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03, 0, 0, 0, 0]);
  expect(sniffSupportImage(jpeg)).toBe('image/jpeg');
  expect(imageDimensions(jpeg, 'image/jpeg')).toEqual({ width: 800, height: 600 });
  const webp = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8X');
  expect(sniffSupportImage(webp)).toBe('image/webp');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  expect(checkSupportImage(svg)).toEqual({ ok: false, error: 'Format accepté : capture ou photo JPEG, PNG ou WebP.' });
  expect(checkSupportImage(new TextEncoder().encode('<html><script>alert(1)</script>'))).toMatchObject({ ok: false });
  expect(checkSupportImage(new Uint8Array(0))).toMatchObject({ ok: false });
  expect(checkSupportImage(new Uint8Array(SUPPORT_LIMITS.attachmentBytes + 1))).toMatchObject({ ok: false, error: 'Image trop lourde : 5 Mo au maximum.' });
  expect(checkSupportImage(png(10, 10))).toEqual({ ok: true, mime: 'image/png', width: 10, height: 10 });
});

// ─── Errors: French message, never internal detail ───────────────────────────

test('every SQL error code raised by 163 has a French message; anything else is generic', () => {
  const raised = new Set([...MIGRATION.matchAll(/raise exception '(support_[a-z_]+)'/g)].map((match) => match[1]!));
  expect(raised.size).toBeGreaterThan(8);
  for (const code of raised) expect(SUPPORT_ERRORS[code], code).toBeDefined();
  expect(supportErrorCode({ message: 'support_rate_limited' })).toBe('support_rate_limited');
  expect(supportErrorCode({ message: 'duplicate key value violates unique constraint "support_tickets_pkey"' })).toBeNull();
  expect(supportErrorCode(null)).toBeNull();
});

// ─── Access control ──────────────────────────────────────────────────────────

test('shop APIs need support.use; console APIs are absent from the tenant capability map', () => {
  for (const [path, method] of [
    ['/api/admin/assistance/tickets', 'POST'], [`/api/admin/assistance/tickets/${ID}`, 'GET'], [`/api/admin/assistance/tickets/${ID}/messages`, 'POST'],
    [`/api/admin/assistance/tickets/${ID}/read`, 'POST'], [`/api/admin/assistance/tickets/${ID}/feedback`, 'POST'], ['/api/admin/assistance/similar', 'GET'],
    ['/api/admin/assistance/improve', 'POST'], ['/api/admin/assistance/attachments', 'POST'], [`/api/admin/assistance/attachments/${ID}`, 'DELETE'],
  ] as const) {
    expect(permissionForAdminApi(path, method), `${method} ${path}`).toBe('support.use');
  }
  expect(permissionForAdminApi('/api/admin/assistancex', 'GET')).toBeNull();
  expect(permissionForAdminApi('/api/admin/platform/assistance/tickets', 'POST')).toBeNull();
  expect(permissionForAdminApi(`/api/admin/platform/assistance/tickets/${ID}`, 'PATCH')).toBeNull();
});

test('every shop route goes through supportTenantApi, every console route through supportPlatformApi', () => {
  const tenantRoutes = filesUnder(join(ROOT, 'src/app/api/admin/assistance')).filter((file) => file.endsWith('route.ts'));
  const platformRoutes = filesUnder(join(ROOT, 'src/app/api/admin/platform/assistance')).filter((file) => file.endsWith('route.ts'));
  expect(tenantRoutes.length).toBeGreaterThanOrEqual(8);
  expect(platformRoutes.length).toBeGreaterThanOrEqual(7);
  for (const file of tenantRoutes) {
    const source = readFileSync(file, 'utf8');
    const handlers = source.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? [];
    expect((source.match(/await supportTenantApi\(/g) ?? []).length, file).toBe(handlers.length);
    // The tenant always comes from the server, never from the request.
    expect(source, file).not.toMatch(/body\.tenantId|searchParams\.get\('tenant/);
    // Shop routes read through the public projection RPCs only.
    expect(source, file).not.toMatch(/from\('support_(messages|events|links)'\)/);
    expect(source, file).not.toContain("'internal_note'");
  }
  for (const file of platformRoutes) {
    const source = readFileSync(file, 'utf8');
    const handlers = source.match(/export async function (GET|POST|PATCH|DELETE)/g) ?? [];
    expect((source.match(/await supportPlatformApi\(/g) ?? []).length, file).toBe(handlers.length);
  }
});

test('shop reads never touch the private tables directly', () => {
  const tenantService = readFileSync(join(ROOT, 'src/lib/support/server/tenantService.ts'), 'utf8');
  expect(tenantService).not.toMatch(/from\('support_/);
  for (const rpc of ['support_tenant_ticket_page', 'support_tenant_thread', 'support_tenant_unread_count', 'support_similar_tickets']) {
    expect(tenantService).toContain(rpc);
  }
  // The thread RPC filters out notes, internal files and private events.
  const thread = MIGRATION.slice(MIGRATION.indexOf('function public.support_tenant_thread'), MIGRATION.indexOf('-- Demandes ouvertes semblables'));
  expect(thread).toContain("m.kind = 'message'");
  expect(thread).toContain('not a.internal');
  expect(thread).toContain('e.public');
  expect(thread).toContain('t.tenant_id = p_tenant_id and t.visible_to_tenant');
  expect(thread).not.toMatch(/priority|assignee|support_links/);
  // No HTML rendering of user text anywhere in the module.
  const ui = [
    ...filesUnder(join(ROOT, 'src/app/admin/(protected)/assistance')),
    ...filesUnder(join(ROOT, 'src/app/admin/(protected)/platform/assistance')),
    ...filesUnder(join(ROOT, 'src/app/admin/_components/support')),
  ];
  for (const file of ui) expect(readFileSync(file, 'utf8'), file).not.toContain('dangerouslySetInnerHTML');
});

test('privileges: RLS forced, no browser role, the service role only reads (writes through RPCs)', () => {
  expect(MIGRATION).toContain("'revoke all on public.%I from public, anon, authenticated, service_role'");
  expect(MIGRATION).toContain("'alter table public.%I force row level security'");
  expect(MIGRATION).toContain('grant insert, delete on public.support_attachments to service_role;');
  expect(MIGRATION).not.toMatch(/grant [^;]* to (anon|authenticated)/);
  expect(MIGRATION).toContain("('support-attachments', 'support-attachments', false,");
  const definers = [...MIGRATION.matchAll(/create or replace function public\.(support_[a-z_]+)\(/g)].map((match) => match[1]!);
  for (const name of definers) expect(MIGRATION, name).toMatch(new RegExp(`'${name}\\(`));
});

test('flag: platform-only, off by default; the shop notification type only with the module', () => {
  expect(featureFlagDefinition(SUPPORT_FLAG)).toMatchObject({ platformOnly: true });
  const off = availableNotificationTypes(notificationTypeContext({ events_enabled: true })).map((type) => type.key);
  const on = availableNotificationTypes(notificationTypeContext({ events_enabled: true }, { support: true })).map((type) => type.key);
  expect(off).not.toContain('support_reply');
  expect(on).toContain('support_reply');
});

test('journal: support events are platform-only (notes, priorities and assignments never reach a shop)', () => {
  expect(AUDIT_MODULES.support).toMatchObject({ platformOnly: true });
  const shop = resolveJournalScope({ isPlatformOwner: false, can: () => true, flags: { business_management: true, whatsapp_business: true } });
  expect(shop.modules).not.toContain('support');
  const owner = resolveJournalScope({ isPlatformOwner: true, can: () => true, flags: { business_management: false, whatsapp_business: false } });
  expect(owner.modules).toContain('support');
});

test('manual requests come from another channel, never « app »', () => {
  expect(isSupportManualChannel('whatsapp')).toBe(true);
  expect(isSupportManualChannel('app')).toBe(false);
  expect(MIGRATION).toContain("constraint support_tickets_manual_channel check (origin = 'tenant_app' or source_channel <> 'app')");
  expect(MIGRATION).toContain("check (relayed_from is null or author_type = 'lepefy')");
});

test('console list: URL state parsed on the server, unknown values dropped', () => {
  const values = SUPPORT_LIST.parse({ view: 'stale', status: 'hacked', priority: 'high', tenant: 'nope', q: "n° 1042'; drop", sort: 'attention', page: '2' });
  expect(values.view).toBe('stale');
  expect(values.status).toBeUndefined();
  expect(values.priority).toBe('high');
  expect(values.tenant).toBeUndefined();
  expect(values.q).toBe('n 1042 drop');
  expect(values.page).toBe(2);
  expect(SUPPORT_LIST.parse({}).view).toBe('open');
  expect(SUPPORT_LIST.href('/admin/platform/assistance', values, { view: 'new' })).toContain('view=new');
});
