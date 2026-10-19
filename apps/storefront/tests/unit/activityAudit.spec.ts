import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUDIT_EVENT_TYPES, AUDIT_MODULES, AUDIT_MODULE_KEYS, auditDetailLabel, auditDetailValue, auditEventLabel, auditEventOptions, auditResourceHref,
} from '../../src/lib/audit/eventCatalog';
import { resolveJournalScope } from '../../src/lib/audit/scope';
import { buildFeedFilters, toEventView, type AuditFeedRow } from '../../src/lib/audit/feedModel';
import { maskText, sanitizeAuditJson, sanitizeChanges } from '../../src/lib/audit/sanitize';
import { buildActivityCsv, csvCell } from '../../src/lib/audit/auditCsv';
import { ACTIVITY_LIST, activityCriteria, cleanActivitySearch, romeMidnight } from '../../src/lib/audit/activityListParams';
import { auditHeaders, isAuditedWrite, registerRequestActor, requestActor, routeRef } from '../../src/lib/audit/requestContext';
import { FEATURE_FLAG_DEFINITIONS } from '../../src/lib/featureFlags/featureFlagRegistry';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/153_admin_activity_audit.sql'), 'utf8');
const CAMPAIGN_MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/157_catalog_campaigns.sql'), 'utf8');
const STAFF_NOTIFICATIONS_MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/158_staff_notifications_whatsapp.sql'), 'utf8');
const PREPARATION_MIGRATION = readFileSync(resolve(__dirname, '../../../../supabase/migrations/160_order_preparation_modes.sql'), 'utf8');
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const all = () => true;
const only = (...permissions: string[]) => (permission: string) => permissions.includes(permission);
const NO_FLAGS = { business_management: false, whatsapp_business: false };

// ─── Catalogue: TS ↔ SQL ────────────────────────────────────────────────────

test('the TS catalogue matches the audit_event_types seeds of migrations 153, 157, 158 and 160 exactly', () => {
  const block = MIGRATION.slice(MIGRATION.indexOf('insert into public.audit_event_types'), MIGRATION.indexOf('on conflict (key) do update set\n  module = excluded.module,\n  category'))
    + CAMPAIGN_MIGRATION.slice(CAMPAIGN_MIGRATION.indexOf('insert into public.audit_event_types'),
      CAMPAIGN_MIGRATION.indexOf('on conflict(key) do nothing;'))
    + STAFF_NOTIFICATIONS_MIGRATION.slice(STAFF_NOTIFICATIONS_MIGRATION.indexOf('insert into public.audit_event_types'),
      STAFF_NOTIFICATIONS_MIGRATION.indexOf('on conflict (key) do nothing;'))
    + PREPARATION_MIGRATION.slice(PREPARATION_MIGRATION.indexOf('insert into public.audit_event_types'),
      PREPARATION_MIGRATION.indexOf('on conflict (key) do nothing;'));
  const rows = [...block.matchAll(/\('([a-z_.]+)',\s*'([a-z_]+)',\s*'([a-z]+)',\s*'([a-z]+)',\s*'([a-z]+)'\)/g)]
    .map(([, key, module, category, severity, retention]) => ({ key, module, category, severity, retention }));
  expect(rows.length).toBeGreaterThan(30);
  expect(rows.map((row) => row.key).sort()).toEqual(Object.keys(AUDIT_EVENT_TYPES).sort());
  for (const row of rows) {
    const ts = AUDIT_EVENT_TYPES[row.key as keyof typeof AUDIT_EVENT_TYPES];
    expect({ module: ts.module, category: ts.category, severity: ts.severity, retention: ts.retention }, row.key)
      .toEqual({ module: row.module, category: row.category, severity: row.severity, retention: row.retention });
  }
});

test('every event belongs to a known module and has a French label', () => {
  for (const [key, definition] of Object.entries(AUDIT_EVENT_TYPES)) {
    expect(AUDIT_MODULE_KEYS, key).toContain(definition.module);
    expect(definition.label.length, key).toBeGreaterThan(3);
    expect(key).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
  }
});

test('historical event types get readable labels, unknown ones are humanised', () => {
  expect(auditEventLabel('gestion.payment.verified')).toBe('Paiement fournisseur vérifié');
  expect(auditEventLabel('orders.preorder.stock_conflict')).toBe('Conflit de stock');
  expect(auditEventLabel('whatsapp.conversation.agent_takeover')).toBe('Conversation reprise par l’équipe');
  expect(auditEventLabel('security.legacy.membership_created')).toBe('Accès accordé (historique)');
  expect(auditEventLabel('whatsapp.conversation.brand_new_event')).toBe('Brand new event');
});

test('every WhatsApp audit event written by the code has a French label', () => {
  for (const type of ['agent_takeover', 'automation_resumed', 'automation_auto_resumed', 'business_app_reply', 'channel_created',
    'channel_updated', 'channel_settings_updated', 'channel_test_sent', 'conversation_closed', 'conversation_reopened',
    'conversation_erased', 'handoff_requested', 'rules_updated']) {
    const label = auditEventLabel(`whatsapp.conversation.${type}`);
    expect(label, type).not.toBe(type.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
  }
});

test('event details get French labels and known values', () => {
  expect(auditDetailLabel('fulfillment_type')).toBe('Mode de remise');
  expect(auditDetailValue('fulfillment_type', 'delivery')).toBe('Livraison');
  expect(auditDetailValue('confirmation_source', 'admin_verified')).toBe('Vérifié par l’équipe');
  expect(auditDetailValue('reference', 'VIR-2231')).toBe('VIR-2231');
  expect(auditDetailLabel('some_new_key')).toBe('Some new key');
});

test('resource links only for safe ids', () => {
  expect(auditResourceHref('order', TENANT_A)).toBe(`/admin/orders/${TENANT_A}`);
  expect(auditResourceHref('order', '../../etc')).toBeNull();
  expect(auditResourceHref('product', 'javascript:alert(1)')).toBeNull();
  expect(auditResourceHref('unknown_type', TENANT_A)).toBeNull();
});

// ─── Permissions per section ────────────────────────────────────────────────

test('scope: a role only reads the modules of its own permissions', () => {
  const cashier = resolveJournalScope({ isPlatformOwner: false, can: only('audit.view', 'orders.view'), flags: NO_FLAGS });
  expect(cashier.modules.sort()).toEqual(['orders', 'payments', 'shipping']);
  expect(cashier.categories).toEqual(['activity', 'automation']);
  expect(cashier.canExport).toBe(false);
  expect(cashier.canSeeSecurity).toBe(false);
  expect(cashier.canSeePlatform).toBe(false);
});

test('scope: Gestion and WhatsApp modules follow their release flags; platform data never reaches a tenant', () => {
  const tenantAdmin = (permission: string) => !permission.startsWith('platform.');
  const off = resolveJournalScope({ isPlatformOwner: false, can: tenantAdmin, flags: NO_FLAGS });
  expect(off.modules).not.toContain('gestion_treasury');
  expect(off.modules).not.toContain('whatsapp');
  expect(off.modules).not.toContain('platform_billing');
  expect(off.modules).not.toContain('external_catalog');
  expect(off.canSeeSecurity).toBe(true);
  expect(off.canSeePlatform).toBe(false);
  const on = resolveJournalScope({ isPlatformOwner: false, can: tenantAdmin, flags: { business_management: true, whatsapp_business: true } });
  expect(on.modules).toEqual(expect.arrayContaining(['gestion_treasury', 'whatsapp']));
  const stockClerk = resolveJournalScope({ isPlatformOwner: false, can: only('audit.view', 'inventory.view'), flags: { business_management: true, whatsapp_business: false } });
  expect(stockClerk.modules).toEqual(['gestion_inventory']);
});

test('scope: the platform owner sees every module and the global view', () => {
  const owner = resolveJournalScope({ isPlatformOwner: true, can: all, flags: NO_FLAGS });
  expect(owner.modules.sort()).toEqual([...AUDIT_MODULE_KEYS].sort());
  expect(owner.canSeePlatform).toBe(true);
  expect(owner.categories).toContain('security');
});

// ─── Tenant isolation of the filters sent to SQL ────────────────────────────

test('filters: the tenant always comes from the server scope; cross-tenant needs the platform view', () => {
  const tenantAdmin = resolveJournalScope({ isPlatformOwner: false, can: (p) => !p.startsWith('platform.'), flags: NO_FLAGS });
  const filters = buildFeedFilters(tenantAdmin, { tenantIds: [TENANT_A] }, { search: TENANT_B });
  expect(filters.tenant_ids).toEqual([TENANT_A]);
  expect(filters.include_platform).toBe(false);
  // A tenant admin asking for all tenants gets an empty module list → the RPC returns nothing.
  expect(buildFeedFilters(tenantAdmin, { allTenants: true }).modules).toEqual([]);
  const owner = resolveJournalScope({ isPlatformOwner: true, can: all, flags: NO_FLAGS });
  expect(buildFeedFilters(owner, { allTenants: true })).toMatchObject({ all_tenants: true, include_platform: true });
});

test('filters: modules, categories and ids outside the scope are dropped (fail-closed)', () => {
  const cashier = resolveJournalScope({ isPlatformOwner: false, can: only('audit.view', 'orders.view'), flags: NO_FLAGS });
  expect(buildFeedFilters(cashier, { tenantIds: [TENANT_A] }, { modules: ['gestion_treasury'] }).modules).toEqual([]);
  expect(buildFeedFilters(cashier, { tenantIds: [TENANT_A] }, { categories: ['security'] }).categories).toEqual([]);
  expect(buildFeedFilters(cashier, { tenantIds: ['not-a-uuid'] }).tenant_ids).toEqual([]);
  expect(buildFeedFilters(cashier, { tenantIds: [TENANT_A] }, { actorAdminId: "x' or 1=1" })).not.toHaveProperty('actor_admin_id');
});

// ─── Sanitisation ───────────────────────────────────────────────────────────

test('sanitize: secrets and personal keys dropped, personal values masked, size bounded', () => {
  const clean = sanitizeAuditJson({
    reference: 'VIR-2231', packlink_api_key: 'pk_live_123', email: 'a@b.fr', note: 'Client a@b.fr +39 333 123 4567 IBAN FR76 3000 6000 0112 3456 7890 189',
    nested: { token: 'secret', ok: true }, long: 'x'.repeat(500),
  }) as Record<string, unknown>;
  expect(clean.reference).toBe('VIR-2231');
  expect(clean).not.toHaveProperty('packlink_api_key');
  expect(clean).not.toHaveProperty('email');
  expect(JSON.stringify(clean)).not.toMatch(/a@b\.fr|333 123|FR76|secret/);
  expect((clean.nested as Record<string, unknown>).ok).toBe(true);
  expect((clean.long as string).length).toBe(200);
  expect(maskText('carte 4242 4242 4242 4242')).toBe('carte [numéro masqué]');
});

test('sanitize: changes of sensitive fields never carry a value', () => {
  const changes = sanitizeChanges([
    { field: 'status', before: 'new', after: 'preparing' },
    { field: 'email', before: 'a@b.fr', after: 'c@d.fr' },
    { field: 'shipping_address', redacted: true },
    { field: 'notes', before: 'appeler le 0612345678', after: 'ok' },
    'garbage', null, { before: 'no field' },
  ]);
  expect(changes).toEqual([
    { field: 'status', before: 'new', after: 'preparing' },
    { field: 'email', redacted: true },
    { field: 'shipping_address', redacted: true },
    { field: 'notes', before: 'appeler le 0612345678', after: 'ok' },
  ]);
});

const row = (patch: Partial<AuditFeedRow>): AuditFeedRow => ({
  id: 'ae:0a000000-0000-4000-8000-000000000001', source: 'audit_events', tenant_id: TENANT_A,
  event_type: 'orders.order.status_changed', module: 'orders', category: 'activity', severity: 'info', outcome: 'success',
  actor_type: 'admin', actor_admin_id: TENANT_B, actor_label: 'Marie Dupont', actor_ref: '/api/admin/orders/[id]',
  resource_type: 'order', resource_id: '0a000000-0000-4000-8000-000000000001', resource_label: '#0A000000',
  changes: [{ field: 'status', before: 'new', after: 'preparing' }], metadata: { recipients: ['x@y.z'], fulfillment_type: 'delivery' },
  correlation_id: 'req-1', occurred_at: '2026-10-10T08:00:00.000Z', recorded_at: '2026-10-10T08:00:00.000Z', ...patch,
});

test('view: labels, link and masked metadata', () => {
  const view = toEventView(row({}));
  expect(view.label).toBe('Statut de la commande modifié');
  expect(view.moduleLabel).toBe('Commandes');
  expect(view.resourceHref).toBe('/admin/orders/0a000000-0000-4000-8000-000000000001');
  expect(view.metadata).toEqual({ fulfillment_type: 'delivery' });
});

// ─── CSV export ─────────────────────────────────────────────────────────────

test('csv: formulas neutralised, BOM, separator, platform column only on request', () => {
  expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
  expect(csvCell('+1')).toBe('"\'+1"');
  expect(csvCell('-2')).toBe('"\'-2"');
  expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
  expect(csvCell('ligne\nsuivante')).toBe('"ligne suivante"');
  const csv = buildActivityCsv([toEventView(row({ resource_label: '=cmd|calc' }))]);
  expect(csv.startsWith('﻿"Date";"Événement"')).toBe(true);
  expect(csv).toContain('"\'=cmd|calc"');
  expect(csv).toContain('Statut : new → preparing');
  expect(csv).not.toContain('Boutique');
  expect(buildActivityCsv([], { withTenant: new Map() })).toContain('"Boutique"');
});

// ─── URL state → criteria ───────────────────────────────────────────────────

test('list params: period, outcome, search and resource map to feed criteria', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const values = ACTIVITY_LIST.parse({ tab: 'automation', period: '24h', outcome: 'failure', q: "#AB12'; drop", rt: 'order', rid: TENANT_A, sort: 'oldest' });
  const criteria = activityCriteria(values, now);
  expect(criteria.categories).toEqual(['automation']);
  expect(criteria.from).toBe('2026-10-09T12:00:00.000Z');
  expect(criteria.outcomes).toEqual(['failure', 'unknown']);
  expect(criteria.search).toBe('#AB12 drop');
  expect(criteria).toMatchObject({ resourceType: 'order', resourceId: TENANT_A, ascending: true });
  expect(activityCriteria(values, now, { ignoreOutcome: true }).outcomes).toBeUndefined();
  expect(activityCriteria(ACTIVITY_LIST.parse({ outcome: 'critical' }), now).severities).toEqual(['critical']);
  expect(activityCriteria(ACTIVITY_LIST.parse({ tab: 'root' }), now).categories).toEqual(['activity']);
  expect(cleanActivitySearch('ae:0192c4e1-aaaa')).toBe('ae:0192c4e1-aaaa');
});

test('list params: custom dates are Europe/Rome days (summer and winter time)', () => {
  expect(romeMidnight('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
  expect(romeMidnight('2026-12-01')).toBe('2026-11-30T23:00:00.000Z');
  const criteria = activityCriteria(ACTIVITY_LIST.parse({ from: '2026-10-01', to: '2026-10-05' }));
  expect(criteria.from).toBe('2026-09-30T22:00:00.000Z');
  expect(criteria.to).toBe('2026-10-05T22:00:00.000Z');
});

// ─── Actor attribution plumbing ─────────────────────────────────────────────

test('request context: only writes carry audit headers; read RPCs of ISR pages never do', () => {
  expect(isAuditedWrite('https://x.supabase.co/rest/v1/orders?id=eq.1', 'PATCH')).toBe(true);
  expect(isAuditedWrite('https://x.supabase.co/rest/v1/orders?select=*', 'GET')).toBe(false);
  expect(isAuditedWrite('https://x.supabase.co/rest/v1/rpc/match_products', 'POST')).toBe(false);
  expect(isAuditedWrite('https://x.supabase.co/rest/v1/rpc/catalog_ranked_product_ids', 'POST')).toBe(false);
  expect(isAuditedWrite('https://x.supabase.co/rest/v1/rpc/replace_admin_role_permissions', 'POST')).toBe(true);
  expect(isAuditedWrite('https://x.supabase.co/storage/v1/object/bucket/file', 'POST')).toBe(false);
});

test('request context: headers are ASCII-safe, invalid parts dropped, registry keyed by request id', () => {
  const headers = auditHeaders({ actorType: 'admin', adminId: TENANT_A, label: 'Amélie N’Diaye', ref: '/api/admin/orders/[id]' }, 'req-1');
  expect(headers['x-lepefy-audit-actor-id']).toBe(TENANT_A);
  expect(Buffer.from(headers['x-lepefy-audit-actor-label']!, 'base64').toString('utf8')).toBe('Amélie N’Diaye');
  expect(Object.values(headers).every((value) => /^[\x20-\x7e]*$/.test(value))).toBe(true);
  const bad = auditHeaders({ actorType: 'admin', adminId: 'nope', ref: 'a b;c' }, 'bad id');
  expect(bad).not.toHaveProperty('x-lepefy-audit-actor-id');
  expect(bad).not.toHaveProperty('x-lepefy-audit-actor-ref');
  expect(bad).not.toHaveProperty('x-lepefy-audit-correlation-id');
  expect(routeRef(`/api/admin/orders/${TENANT_A}/picking`)).toBe('/api/admin/orders/[id]/picking');
  registerRequestActor('req-42', { actorType: 'platform_owner', adminId: TENANT_A });
  expect(requestActor('req-42')?.actorType).toBe('platform_owner');
  expect(requestActor('req-43')).toBeNull();
  expect(requestActor(null)).toBeNull();
});

// ─── Release flag and route permissions ─────────────────────────────────────

test('activity_journal is a platform-only release flag', () => {
  const flag = FEATURE_FLAG_DEFINITIONS.find((definition) => definition.key === 'activity_journal');
  expect(flag?.platformOnly).toBe(true);
});

test('pages and APIs of the journal are mapped, writes fail closed', () => {
  expect(permissionsForAdminPath('/admin/activite', 'shop')).toEqual(['audit.view']);
  expect(permissionForAdminApi('/api/admin/activite', 'GET')).toBe('audit.view');
  expect(permissionForAdminApi('/api/admin/activite/ae:123', 'GET')).toBe('audit.view');
  expect(permissionForAdminApi('/api/admin/activite/export', 'GET')).toBe('audit.export');
  expect(permissionForAdminApi('/api/admin/activite', 'POST')).toBeNull();
  expect(permissionForAdminApi('/api/admin/activite/ae:123', 'DELETE')).toBeNull();
});

test('modules offered in filters exist in the module registry', () => {
  for (const option of auditEventOptions(AUDIT_MODULE_KEYS)) expect(Object.keys(AUDIT_EVENT_TYPES)).toContain(option.value);
  for (const definition of Object.values(AUDIT_MODULES)) expect(definition.label.length).toBeGreaterThan(2);
});
