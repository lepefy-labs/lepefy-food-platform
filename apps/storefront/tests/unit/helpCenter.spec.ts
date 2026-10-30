import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HELP_STATUSES, HELP_DISABLED_FLAG, type HelpArticleView, type HelpContextRow } from '../../src/lib/helpCenter/domain';
import {
  HELP_TRANSITIONS, blocksSearchText, canTransition, cleanSearchQuery, isSearchable, isValidSlug, levelAllows, minimiseSearchTerm,
  parseInline, resolveHelpLevel, slugify,
} from '../../src/lib/helpCenter/rules';
import { isAllowedImageSrc, isAllowedVideoUrl, parseBlocks } from '../../src/lib/helpCenter/blocks';
import {
  isArticleVisible, isLocaleFallback, matchRoutePattern, normalizeHelpRoute, resolveHelpContext, type HelpViewer,
} from '../../src/lib/helpCenter/contextResolver';
import { INITIAL_LIBRARY } from '../../src/lib/helpCenter/library/initialLibrary';
import { ADMIN_NAV, resolveAdminNavigation } from '../../src/lib/admin/navigation';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';
import { featureFlagDefinition } from '../../src/lib/featureFlags/featureFlagRegistry';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(ROOT, '../../supabase/migrations/174_help_center.sql'), 'utf8');
const ID = '0f8c2b36-5a3d-4c41-9f2e-6c1b8c0a1d11';

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function article(over: Partial<HelpArticleView> & { id: string; slug: string }): HelpArticleView {
  return {
    module: 'commandes', minLevel: 'standard', requiredPermission: null, requiredFlag: null, position: 100, version: 1,
    updatedAt: null, localeUsed: 'fr', title: over.slug, summary: '', blocks: [], ...over,
  };
}

const viewer = (over: Partial<HelpViewer> = {}): HelpViewer => ({ level: 'standard', permissions: ['help.view', 'orders.view'], flags: [], ...over });

// ─── Access level: one resolver, fixed precedence ────────────────────────────

test('level resolver: suspension and administrative disable beat every entitlement', () => {
  const on = { standard: true, advanced: true };
  expect(resolveHelpLevel({ suspended: true, adminDisabled: false, ...on })).toBe('disabled');
  expect(resolveHelpLevel({ suspended: false, adminDisabled: true, ...on })).toBe('disabled');
  expect(resolveHelpLevel({ suspended: true, adminDisabled: true, ...on })).toBe('disabled');
});

test('level resolver: advanced > standard > nothing', () => {
  const base = { suspended: false, adminDisabled: false };
  expect(resolveHelpLevel({ ...base, standard: true, advanced: true })).toBe('advanced');
  expect(resolveHelpLevel({ ...base, standard: false, advanced: true })).toBe('advanced');
  expect(resolveHelpLevel({ ...base, standard: true, advanced: false })).toBe('standard');
  expect(resolveHelpLevel({ ...base, standard: false, advanced: false })).toBe('disabled');
});

test('levelAllows: advanced guides need the advanced level; disabled sees nothing', () => {
  expect(levelAllows('standard', 'standard')).toBe(true);
  expect(levelAllows('standard', 'advanced')).toBe(false);
  expect(levelAllows('advanced', 'advanced')).toBe(true);
  expect(levelAllows('disabled', 'standard')).toBe(false);
});

test('the kill-switch is a declared platform-only flag and a capability is mapped for route and API', () => {
  expect(featureFlagDefinition(HELP_DISABLED_FLAG)?.platformOnly).toBe(true);
  expect(permissionForAdminApi('/api/admin/help/search', 'GET')).toBe('help.view');
  expect(permissionForAdminApi('/api/admin/help/events', 'POST')).toBe('help.view');
  expect(permissionsForAdminPath('/admin/aide/preparer-une-commande', 'shop')).toEqual(['help.view']);
  // Console APIs are platform-owner only: absent from the capability map.
  expect(permissionForAdminApi('/api/admin/platform/knowledge/articles', 'POST')).toBeNull();
});

// ─── Routes ──────────────────────────────────────────────────────────────────

test('route normalisation masks ids and rejects query strings, hashes and foreign paths', () => {
  expect(normalizeHelpRoute(`/admin/orders/${ID}`)).toBe('/admin/orders/[id]');
  expect(normalizeHelpRoute(`/admin/orders/${ID}?token=secret#x`)).toBe('/admin/orders/[id]');
  expect(normalizeHelpRoute('/admin/catalogue/12345')).toBe('/admin/catalogue/[id]');
  expect(normalizeHelpRoute('/admin/')).toBe('/admin');
  expect(normalizeHelpRoute('/products/x')).toBeNull();
  expect(normalizeHelpRoute('/admin/../etc')).toBeNull();
  expect(normalizeHelpRoute('https://evil.test/admin')).toBeNull();
  expect(normalizeHelpRoute(undefined)).toBeNull();
  expect(normalizeHelpRoute('/admin/' + 'a'.repeat(300))).toBeNull();
});

test('pattern matching: exact beats [id] beats nothing; wildcard covers a module', () => {
  expect(matchRoutePattern('/admin/orders', '/admin/orders')).toBeGreaterThan(0);
  expect(matchRoutePattern('/admin/orders', '/admin/orders/[id]')).toBe(-1);
  expect(matchRoutePattern('/admin/orders/[id]', '/admin/orders/[id]')).toBeGreaterThan(matchRoutePattern('/admin/orders/*', '/admin/orders/[id]'));
  expect(matchRoutePattern('/admin/orders/*', '/admin/orders/[id]')).toBeGreaterThan(0);
  expect(matchRoutePattern('/admin/orders/*', '/admin/orders')).toBe(-1);
  expect(matchRoutePattern('/admin/catalogue', '/admin/orders')).toBe(-1);
});

// ─── Context engine ──────────────────────────────────────────────────────────

const A = article({ id: 'a', slug: 'preparer-une-commande', position: 10 });
const B = article({ id: 'b', slug: 'imprimer-les-documents', position: 20 });
const C = article({ id: 'c', slug: 'guide-gestion', module: 'gestion', requiredFlag: 'business_management' });
const D = article({ id: 'd', slug: 'guide-avance', minLevel: 'advanced' });
const E = article({ id: 'e', slug: 'reglages', module: 'parametres', requiredPermission: 'tenant_settings.view' });
const contexts: HelpContextRow[] = [
  { articleId: 'a', routePattern: '/admin/orders', action: null, priority: 10 },
  { articleId: 'b', routePattern: '/admin/orders/*', action: null, priority: 20 },
  { articleId: 'c', routePattern: '/admin/orders', action: null, priority: 30 },
  { articleId: 'd', routePattern: '/admin/orders', action: null, priority: 40 },
  { articleId: 'e', routePattern: '/admin/orders', action: null, priority: 50 },
];
const all = [A, B, C, D, E];

test('context: specific match first, authorised only (capability, flag, level)', () => {
  const result = resolveHelpContext({ pathname: '/admin/orders', articles: all, contexts, viewer: viewer() });
  expect(result.route).toBe('/admin/orders');
  expect(result.primary.map((a) => a.slug)).toEqual(['preparer-une-commande']);
  // not offered: flag off (C), advanced level (D), missing capability (E)
  expect(result.primary.map((a) => a.id)).not.toContain('c');
  expect(result.primary.map((a) => a.id)).not.toContain('d');
  expect(result.primary.map((a) => a.id)).not.toContain('e');
  expect(result.fallback).toBe(false);
});

test('context: capability, flag and level each unlock their guide', () => {
  const rich = viewer({ level: 'advanced', permissions: ['help.view', 'tenant_settings.view'], flags: ['business_management'] });
  const ids = resolveHelpContext({ pathname: '/admin/orders', articles: all, contexts, viewer: rich }).primary.map((a) => a.id).sort();
  expect(ids).toEqual(['a', 'c', 'd', 'e']);
});

test('context: module-wide wildcard is used on a detail page; related guides share the module', () => {
  const result = resolveHelpContext({ pathname: `/admin/orders/${ID}`, articles: all, contexts, viewer: viewer() });
  expect(result.primary.map((a) => a.id)).toEqual(['b']);
  expect(result.related.map((a) => a.id)).toEqual(['a']);
});

test('context: no association → fallback (search / general guide), never an error', () => {
  const result = resolveHelpContext({ pathname: '/admin/parametres', articles: all, contexts, viewer: viewer() });
  expect(result.primary).toEqual([]);
  expect(result.fallback).toBe(true);
  expect(resolveHelpContext({ pathname: 'nope', articles: all, contexts, viewer: viewer() }).fallback).toBe(true);
});

test('context: a disabled level offers nothing at all', () => {
  const result = resolveHelpContext({ pathname: '/admin/orders', articles: all, contexts, viewer: viewer({ level: 'disabled' }) });
  expect(result.primary).toEqual([]);
  expect(result.related).toEqual([]);
});

test('the platform owner bypasses the capability filter but never the level or the flag', () => {
  expect(isArticleVisible(E, viewer({ permissions: [], isPlatformOwner: true }))).toBe(true);
  expect(isArticleVisible(C, viewer({ isPlatformOwner: true }))).toBe(false);
  expect(isArticleVisible(D, viewer({ isPlatformOwner: true }))).toBe(false);
});

test('an action refines the match', () => {
  const withAction: HelpContextRow[] = [...contexts, { articleId: 'b', routePattern: '/admin/orders', action: 'close', priority: 5 }];
  expect(resolveHelpContext({ pathname: '/admin/orders', action: null, articles: all, contexts: withAction, viewer: viewer() }).primary.map((a) => a.id)).toEqual(['a']);
  expect(resolveHelpContext({ pathname: '/admin/orders', action: 'close', articles: all, contexts: withAction, viewer: viewer() }).primary[0]!.id).toBe('b');
});

test('language fallback is declared by the served locale', () => {
  expect(isLocaleFallback('it', article({ id: 'x', slug: 'x', localeUsed: 'fr' }))).toBe(true);
  expect(isLocaleFallback('fr', article({ id: 'x', slug: 'x', localeUsed: 'fr' }))).toBe(false);
});

// ─── Workflow parity with SQL ────────────────────────────────────────────────

test('editorial transitions match SQL help_transition_allowed exactly', () => {
  const body = MIGRATION.slice(MIGRATION.indexOf('function public.help_transition_allowed'), MIGRATION.indexOf('-- Moves an article'));
  const sql = [...body.matchAll(/\('([a-z]+)', '([a-z]+)'\)/g)].map((m) => `${m[1]}>${m[2]}`).sort();
  const ts = HELP_STATUSES.flatMap((from) => HELP_TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
  expect(ts).toEqual(sql);
  expect(canTransition('draft', 'published')).toBe(false); // review is mandatory
  expect(canTransition('archived', 'published')).toBe(false);
});

// ─── Content: structured, sanitised ──────────────────────────────────────────

test('blocks: valid structured content passes, unknown or HTML-bearing blocks do not', () => {
  const ok = parseBlocks([{ type: 'heading', text: 'Titre' }, { type: 'steps', items: ['Un', 'Deux'] }, { type: 'callout', tone: 'warning', text: 'Attention' }]);
  expect(ok.ok).toBe(true);
  expect(parseBlocks([{ type: 'html', html: '<script>alert(1)</script>' }]).ok).toBe(false);
  expect(parseBlocks([{ type: 'paragraph', text: 'x', onclick: 'evil()' }]).ok).toBe(false);
  expect(parseBlocks([{ type: 'steps', items: [] }]).ok).toBe(false);
  expect(parseBlocks('not an array').ok).toBe(false);
  expect(parseBlocks(Array.from({ length: 81 }, () => ({ type: 'paragraph', text: 'x' }))).ok).toBe(false);
});

test('blocks: image and video sources are allow-listed', () => {
  expect(isAllowedImageSrc('https://cdn.example.com/a.png')).toBe(true);
  expect(isAllowedImageSrc('/help/commandes.png')).toBe(true);
  for (const bad of ['javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', '//evil.test/a.png', '/help/../secret.png', 'http://insecure.test/a.png', 'https://user:pw@x.test/a.png']) {
    expect(isAllowedImageSrc(bad), bad).toBe(false);
  }
  expect(isAllowedVideoUrl('https://www.youtube-nocookie.com/embed/abc')).toBe(true);
  expect(isAllowedVideoUrl('https://www.youtube.com/embed/abc')).toBe(false);
  expect(isAllowedVideoUrl('https://evil.test/embed/abc')).toBe(false);
  expect(parseBlocks([{ type: 'image', src: 'https://x.test/a.png', alt: '' }]).ok).toBe(false); // alt text is mandatory
});

test('inline markup is limited to **bold** and everything else stays text', () => {
  expect(parseInline('Cliquez sur **Imprimer** puis fermez')).toEqual([
    { text: 'Cliquez sur ', bold: false }, { text: 'Imprimer', bold: true }, { text: ' puis fermez', bold: false },
  ]);
  expect(parseInline('<img src=x onerror=1>')).toEqual([{ text: '<img src=x onerror=1>', bold: false }]);
  expect(blocksSearchText([{ type: 'steps', items: ['**Un**', 'Deux'] }, { type: 'image', alt: 'Capture' }])).toBe('Un Deux Capture');
});

// ─── Search and metrics minimisation ─────────────────────────────────────────

test('search: bounded, cleaned and minimum length', () => {
  expect(cleanSearchQuery('  imprimer\n\tla   liste  ')).toBe('imprimer la liste');
  expect(cleanSearchQuery('x'.repeat(500)).length).toBe(80);
  expect(isSearchable('a')).toBe(false);
  expect(isSearchable('promo')).toBe(true);
  expect(isSearchable('!!')).toBe(false);
});

test('empty-search term keeps no personal data', () => {
  expect(minimiseSearchTerm('Imprimer Étiquette')).toBe('imprimer étiquette');
  expect(minimiseSearchTerm('jean.dupont@mail.com')).toBeNull();
  expect(minimiseSearchTerm(`commande ${ID}`)).toBe('commande');
  expect(minimiseSearchTerm('rappeler +33 6 12 34 56 78')).toBe('rappeler');
  expect(minimiseSearchTerm('1234567890')).toBeNull();
});

test('slugs', () => {
  expect(slugify('Préparer une commande !')).toBe('preparer-une-commande');
  expect(isValidSlug('preparer-une-commande')).toBe(true);
  expect(isValidSlug('Bad Slug')).toBe(false);
  expect(isValidSlug('../x')).toBe(false);
});

// ─── Schema: privileges, isolation, no commercial side effect ────────────────

test('migration 174: RLS forced, explicit grants, nothing for anon or authenticated', () => {
  for (const table of ['help_articles', 'help_article_translations', 'help_article_revisions', 'help_article_contexts', 'help_article_daily', 'help_search_daily']) {
    expect(MIGRATION, table).toContain(`alter table public.${table} force row level security`);
    expect(MIGRATION, table).toMatch(new RegExp(`revoke all on[^;]*public\\.${table}[^;]*from public, anon, authenticated, service_role`));
  }
  expect(MIGRATION).not.toMatch(/create policy/i);
  expect(MIGRATION).not.toMatch(/grant [^;]*to (anon|authenticated)/i);
  for (const fn of ['help_set_status', 'help_restore_revision', 'help_tenant_articles', 'help_tenant_search', 'help_tenant_contexts', 'help_record_event', 'help_record_search', 'help_purge_metrics']) {
    expect(MIGRATION, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(`));
    expect(MIGRATION, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`));
  }
});

test('migration 174: tenants only read published revisions of their own or shared articles', () => {
  for (const fn of ['help_tenant_articles', 'help_tenant_search', 'help_tenant_contexts']) {
    const start = MIGRATION.indexOf(`function public.${fn}`);
    const body = MIGRATION.slice(start, MIGRATION.indexOf('$$;', MIGRATION.indexOf('$$', start + 20)) + 3);
    expect(body, fn).toContain("a.status = 'published'");
    expect(body, fn).toContain('published_version is not null');
    expect(body, fn).toMatch(/a\.tenant_id is null or a\.tenant_id = p_tenant_id/);
  }
  expect(MIGRATION).toContain('help_article_revisions_immutable');
});

test('migration 174 does not grant the entitlement to any plan or tenant and creates no billing object', () => {
  expect(MIGRATION).not.toMatch(/insert into public\.platform_plan_features/i);
  expect(MIGRATION).not.toMatch(/insert into public\.tenant_feature_overrides/i);
  expect(MIGRATION).not.toMatch(/insert into public\.tenant_feature_flags/i);
  expect(MIGRATION).not.toMatch(/create (table|function)[^;]*stripe/i);
  // The advanced level is registered inactive.
  expect(MIGRATION).toMatch(/'help_center_advanced'[\s\S]*?'operations', false, true, 211/);
});

// ─── Independence and safe rendering (static guards) ─────────────────────────

test('the module does not depend on Assistance code or its flag', () => {
  const sources = [...filesUnder(join(ROOT, 'src/lib/helpCenter')), ...filesUnder(join(ROOT, 'src/app/api/admin/help')), ...filesUnder(join(ROOT, 'src/app/admin/_components/help'))];
  expect(sources.length).toBeGreaterThan(5);
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/support_assistance|isSupportEnabled|from '@\/lib\/support/);
  }
});

test('no raw HTML rendering in the Help Center UI', () => {
  const sources = [...filesUnder(join(ROOT, 'src/app/admin/_components/help')), ...filesUnder(join(ROOT, 'src/app/admin/(protected)/aide')), ...filesUnder(join(ROOT, 'src/app/admin/(protected)/platform/knowledge'))];
  for (const file of sources.filter((f) => /\.tsx?$/.test(f))) {
    expect(readFileSync(file, 'utf8'), file).not.toContain('dangerouslySetInnerHTML');
  }
});

test('tenant API routes use the commercial guard; console routes the platform-owner guard', () => {
  for (const file of filesUnder(join(ROOT, 'src/app/api/admin/help')).filter((f) => f.endsWith('route.ts'))) {
    expect(readFileSync(file, 'utf8'), file).toContain('helpTenantApi()');
  }
  for (const file of filesUnder(join(ROOT, 'src/app/api/admin/platform/knowledge')).filter((f) => f.endsWith('route.ts'))) {
    expect(readFileSync(file, 'utf8'), file).toContain('helpPlatformApi()');
  }
});

// ─── Initial library ─────────────────────────────────────────────────────────

test('initial library: 15-20 valid guides, unique slugs, valid contexts, resolvable links', () => {
  expect(INITIAL_LIBRARY.length).toBeGreaterThanOrEqual(15);
  expect(INITIAL_LIBRARY.length).toBeLessThanOrEqual(20);
  const slugs = INITIAL_LIBRARY.map((guide) => guide.slug);
  expect(new Set(slugs).size).toBe(slugs.length);
  for (const guide of INITIAL_LIBRARY) {
    expect(isValidSlug(guide.slug), guide.slug).toBe(true);
    expect(parseBlocks(guide.blocks).ok, guide.slug).toBe(true);
    expect(guide.title.length, guide.slug).toBeLessThanOrEqual(160);
    expect(guide.summary.length, guide.slug).toBeLessThanOrEqual(400);
    expect(guide.contexts.length, guide.slug).toBeGreaterThan(0);
    for (const pattern of guide.contexts) expect(pattern, guide.slug).toMatch(/^\/admin(\/[a-zA-Z0-9._~[\]-]+)*(\/\*)?$/);
    expect(guide.watch.length, guide.slug).toBeGreaterThan(0);
    for (const block of guide.blocks) if (block.type === 'related') expect(slugs, `${guide.slug} → ${block.slug}`).toContain(block.slug);
    if (guide.requiredPermission) expect(guide.requiredPermission).toMatch(/^[a-z_]+\.[a-z_]+$/);
  }
});

test('initial library: no placeholder, no unfinished text, every guide has steps', () => {
  for (const guide of INITIAL_LIBRARY) {
    const text = JSON.stringify(guide);
    expect(text, guide.slug).not.toMatch(/TODO|lorem|XXX|à compléter/i);
  }
  expect(INITIAL_LIBRARY.filter((guide) => guide.blocks.some((block) => block.type === 'steps')).length).toBeGreaterThanOrEqual(14);
});

test('navigation: the Centre d’aide entry needs the entitlement flag and help.view; Assistance is unrelated', () => {
  const ctx = (permissions: string[], help: boolean, support = false) => ({ workspace: 'shop' as const, permissions, isPlatformOwner: false, flags: { gestion: false, whatsapp: false, activity: false, support, help } });
  expect(ADMIN_NAV.some((item) => item.id === 'help')).toBe(true);
  expect(resolveAdminNavigation(ctx(['help.view'], false)).items).not.toContain('help');
  expect(resolveAdminNavigation(ctx(['orders.view'], true)).items).not.toContain('help');
  expect(resolveAdminNavigation(ctx(['help.view'], true, false)).items).toContain('help');
  expect(resolveAdminNavigation(ctx(['help.view'], true, false)).items).not.toContain('assistance');
});
