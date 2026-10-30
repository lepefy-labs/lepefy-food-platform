import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  DOC_REVIEW_STATUSES, FILE_KINDS, RELATION_KINDS, SYMBOL_KINDS, githubLink,
} from '../../src/lib/engineering/domain';
import {
  PERSONAL_EMAIL_THRESHOLD, countPersonalEmails, detectSecret, exclusionForContent, exclusionForPath,
} from '../../src/lib/engineering/exclusions';
import { ENGINEERING_MODULES, globToRegExp, moduleForPath } from '../../src/lib/engineering/moduleRegistry';
import { ENGINEERING_PERMISSIONS, canAccessEngineering } from '../../src/lib/engineering/access';
import { extractTypeScript } from '../../src/lib/engineering/indexer/typescriptExtractor';
import { blankSqlComments, extractSql } from '../../src/lib/engineering/indexer/sqlExtractor';
import { extractMarkdown, parseFrontMatter } from '../../src/lib/engineering/indexer/markdownExtractor';
import { kindOf, routeOf } from '../../src/lib/engineering/indexer/classify';
import { buildSnapshot, filesChecksum, gitBlobSha, type SourceFile } from '../../src/lib/engineering/indexer/buildSnapshot';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionsForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

const ROOT = resolve(__dirname, '../..');
const REPO = resolve(ROOT, '../..');
const MIGRATION = readFileSync(resolve(REPO, 'supabase/migrations/175_engineering_hub.sql'), 'utf8');
const SHA = '1'.repeat(40);

// Synthetic credentials are assembled at run time so this file itself holds no secret-looking literal.
const FAKE = {
  stripe: 'sk_' + 'live_' + 'a1B2c3D4e5F6g7H8i9J0',
  aws: 'AKIA' + '0123456789ABCDEF',
  jwt: 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJ' + 'zdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'abcdefghij1234567',
  pem: '-----BEGIN ' + 'PRIVATE KEY-----',
  whsec: 'whsec_' + 'a1b2c3d4e5f6g7h8i9j0k1l2',
  conn: 'postgres' + '://app:' + 'Hunter2Hunter2' + '@db.example.internal/app',
};

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function sql(strings: TemplateStringsArray): string {
  return strings.raw.join('');
}

test.describe('exclusions: paths', () => {
  test('dependencies, generated files, binaries, dumps and environment files never enter the index', () => {
    expect(exclusionForPath('node_modules/x/index.js')).toBe('vendor_path');
    expect(exclusionForPath('apps/storefront/.next/server/a.js')).toBe('vendor_path');
    expect(exclusionForPath('.env.local')).toBe('denied_path');
    expect(exclusionForPath('apps/storefront/.env.production')).toBe('denied_path');
    expect(exclusionForPath('keys/server.pem')).toBe('denied_path');
    expect(exclusionForPath('artifacts/whatsapp-catalog/out.json')).toBe('denied_path');
    expect(exclusionForPath('.claude/settings.local.json')).toBe('denied_path');
    expect(exclusionForPath('pnpm-lock.yaml')).toBe('lockfile');
    expect(exclusionForPath('public/logo.png')).toBe('binary_extension');
    expect(exclusionForPath('data/customers.csv')).toBe('data_dump');
    expect(exclusionForPath('next-env.d.ts')).toBe('generated');
    expect(exclusionForPath('docs/incidents/report.pdf')).toBe('binary_extension');
    expect(exclusionForPath('data/export.json')).toBe('unsupported_extension');
    expect(exclusionForPath('a/' + 'b'.repeat(520) + '.ts')).toBe('path_too_long');
  });

  test('code, SQL, Markdown, workflows and the known JSON configs are readable', () => {
    for (const path of [
      'apps/storefront/src/lib/a.ts', 'apps/storefront/src/app/page.tsx', 'supabase/migrations/175_x.sql', 'docs/A.md',
      '.github/workflows/ci.yml', 'package.json', 'apps/storefront/tsconfig.json', 'ops/n8n/catalog-schedule.json', '.env.example',
    ]) expect(exclusionForPath(path), path).toBeNull();
  });
});

test.describe('exclusions: content', () => {
  test('each provider-specific secret excludes the whole file and reports only the rule id', () => {
    for (const [name, value] of Object.entries(FAKE)) {
      const content = `// header\nconst x = "${value}";\n`;
      const reason = exclusionForContent(content);
      expect(reason, name).toBe('secret_detected');
      const rule = detectSecret(content);
      expect(rule).toBeTruthy();
      expect(String(rule)).not.toContain(value);
    }
  });

  test('a credential assignment is caught, an environment variable NAME is not', () => {
    expect(detectSecret(`const apiKey = 'k9Zq3Lm8Vb2Nx7Rt5Yw1Qa6Ps4';`)).toBe('credential_assignment');
    expect(detectSecret(`token_env: 'META_WHATSAPP_SYSTEM_USER_TOKEN'`)).toBeNull();
    expect(detectSecret(`const apiKey = process.env.API_KEY;`)).toBeNull();
  });

  test('test fixtures keep their fake values but never a provider-specific secret', () => {
    const fixture = `const TOKEN = 'abc123def456ghi789jkl012mno';`;
    expect(exclusionForContent(fixture)).toBe('secret_detected');
    expect(exclusionForContent(fixture, { isTestFile: true })).toBeNull();
    expect(exclusionForContent(`x = "${FAKE.stripe}"`, { isTestFile: true })).toBe('secret_detected');
  });

  test('placeholder connection strings are fine, a real password is not', () => {
    expect(detectSecret('postgresql://postgres:[YOUR-PASSWORD]@db.example.co:5432/postgres')).toBeNull();
    expect(detectSecret(FAKE.conn)).toBe('connection_string_password');
  });

  test('binary content, oversized files and e-mail extracts are excluded', () => {
    expect(exclusionForContent('a\u0000b')).toBe('binary_content');
    expect(exclusionForContent('x'.repeat(600 * 1024))).toBe('too_large');
    const emails = ['marie.dupont@gmail.com', 'jean.martin@orange.fr', 'awa.diallo@yahoo.fr'].join('\n');
    expect(countPersonalEmails(emails)).toBe(PERSONAL_EMAIL_THRESHOLD);
    expect(exclusionForContent(emails)).toBe('personal_data');
    expect(exclusionForContent('contact: noreply@lepefy.com, test@example.com, support@example.org, a@b.test')).toBeNull();
  });
});

test.describe('registry, access, classification', () => {
  test('globs match literally (brackets, parentheses) and by depth', () => {
    expect(globToRegExp('a/**/c.ts').test('a/c.ts')).toBe(true);
    expect(globToRegExp('a/**/c.ts').test('a/b/x/c.ts')).toBe(true);
    expect(globToRegExp('a/*.ts').test('a/b/c.ts')).toBe(false);
    expect(globToRegExp('app/(shop)/[id]/**').test('app/(shop)/[id]/x/y.ts')).toBe(true);
    expect(globToRegExp('app/(shop)/[id]/**').test('app/shop/i/x.ts')).toBe(false);
  });

  test('paths map to their module, unknown paths to none', () => {
    expect(moduleForPath('apps/storefront/src/lib/helpCenter/rules.ts')).toBe('help-center');
    expect(moduleForPath('supabase/migrations/174_help_center.sql')).toBe('help-center');
    expect(moduleForPath('apps/storefront/src/app/api/checkout/route.ts')).toBe('payments-stripe');
    expect(moduleForPath('apps/storefront/src/lib/purchaseQuantityRules.ts')).toBe('catalog-promotions');
    expect(moduleForPath('apps/storefront/src/lib/gestion/rpc.ts')).toBe('gestion');
    expect(moduleForPath('apps/storefront/src/lib/utils/unknown.ts')).toBeNull();
    expect(new Set(ENGINEERING_MODULES.map((m) => m.moduleKey)).size).toBe(ENGINEERING_MODULES.length);
  });

  test('only the platform owner passes today; the wildcard tenant admin never does', () => {
    const owner = { isPlatformOwner: true, scope: 'platform' as const, permissions: [] };
    const tenantAdmin = { isPlatformOwner: false, scope: 'tenant' as const, permissions: [...ENGINEERING_PERMISSIONS] };
    const member = { isPlatformOwner: false, scope: 'platform' as const, permissions: ['engineering.view'] };
    for (const permission of ENGINEERING_PERMISSIONS) {
      expect(canAccessEngineering(owner, permission)).toBe(true);
      expect(canAccessEngineering(tenantAdmin, permission, { memberAccessEnabled: true })).toBe(false);
      expect(canAccessEngineering(null, permission)).toBe(false);
    }
    expect(canAccessEngineering(member, 'engineering.view')).toBe(false); // member access is off in phase 1
    expect(canAccessEngineering(member, 'engineering.view', { memberAccessEnabled: true })).toBe(true);
    expect(canAccessEngineering(member, 'engineering.admin', { memberAccessEnabled: true })).toBe(false);
  });

  test('files are classified and App Router routes derived from the path', () => {
    expect(kindOf('apps/storefront/src/app/api/admin/help/route.ts')).toBe('api_route');
    expect(kindOf('apps/storefront/src/app/admin/(protected)/aide/page.tsx')).toBe('page');
    expect(kindOf('apps/storefront/tests/unit/a.spec.ts')).toBe('test');
    expect(kindOf('supabase/tests/174_x.test.sql')).toBe('test');
    expect(kindOf('supabase/migrations/174_x.sql')).toBe('migration');
    expect(kindOf('.github/workflows/ci.yml')).toBe('ci');
    expect(kindOf('apps/storefront/src/components/cart/CartStepper.tsx')).toBe('component');
    expect(routeOf('apps/storefront/src/app/api/admin/help/[id]/route.ts')).toEqual({ route: '/api/admin/help/[id]', kind: 'api' });
    expect(routeOf('apps/storefront/src/app/admin/(protected)/aide/page.tsx')).toEqual({ route: '/admin/aide', kind: 'page' });
    expect(routeOf('apps/storefront/src/lib/a.ts')).toBeNull();
  });

  test('GitHub links point to the indexed commit and line range', () => {
    expect(githubLink('o', 'r', SHA, 'a/(b)/c d.ts', 3, 9)).toBe(`https://github.com/o/r/blob/${SHA}/a/(b)/c%20d.ts#L3-L9`);
    expect(githubLink('o', 'r', SHA, 'a.ts', 5, 5)).toBe(`https://github.com/o/r/blob/${SHA}/a.ts#L5`);
  });
});

test.describe('TypeScript extraction', () => {
  const source = [
    '/** Level resolution. */',
    "import { a } from './a';",
    "import type { B } from '@/lib/b';",
    "export * from './c';",
    "const lazy = () => import('./lazy');",
    "const legacy = require('./legacy');",
    '',
    '/** Resolve it. */',
    'export function resolveLevel(x: number): string {',
    '  return String(x);',
    '}',
    'export const useThing = () => 1;',
    'export const Card = () => null;',
    'const hidden = 5;',
    'export class Service { run() {} }',
    'export interface Shape { a: number }',
    'export type Id = string;',
    "export enum Mode { A }",
    'export async function GET() {',
    "  await db.from('orders').select('*');",
    "  await db.rpc('decrement_stock');",
    "  await fetch('/api/shipping/quote?x=1');",
    '  const name = dynamic(); await db.from(name);',
    '}',
    "test.describe('rules', () => {",
    "  test('works', () => {});",
    '});',
  ].join('\n');

  test('declarations, kinds, positions, signatures and doc comments', () => {
    const facts = extractTypeScript('apps/storefront/src/app/api/x/route.ts', source);
    const sym = (name: string) => facts.symbols.find((s) => s.name === name)!;
    expect(sym('resolveLevel')).toMatchObject({ kind: 'function', exported: true, startLine: 9, endLine: 11, doc: 'Resolve it.' });
    expect(sym('resolveLevel').signature).toBe('export function resolveLevel(x: number): string');
    expect(sym('useThing').kind).toBe('hook');
    expect(sym('Card').kind).toBe('function'); // not a .tsx file
    expect(sym('hidden')).toMatchObject({ kind: 'const', exported: false });
    expect(sym('Service').kind).toBe('class');
    expect(sym('Shape').kind).toBe('interface');
    expect(sym('Id').kind).toBe('type');
    expect(sym('Mode').kind).toBe('enum');
    expect(sym('GET').kind).toBe('route_handler');
    expect(sym('rules')).toMatchObject({ kind: 'test', parentName: null });
    expect(sym('works')).toMatchObject({ kind: 'test', parentName: 'rules' });
    expect(facts.headerComment).toBe('Level resolution.');
  });

  test('components are recognised in TSX files', () => {
    const facts = extractTypeScript('a/B.tsx', 'export function Panel() { return <div />; }\nexport const Row = () => <p />;');
    expect(facts.symbols.map((s) => [s.name, s.kind])).toEqual([['Panel', 'component'], ['Row', 'component']]);
  });

  test('imports, tables, RPCs and API calls only from string literals', () => {
    const facts = extractTypeScript('apps/storefront/src/app/api/x/route.ts', source);
    expect(facts.imports.map((i) => i.specifier)).toEqual(['./a', '@/lib/b', './c', './lazy', './legacy']);
    expect(facts.references).toEqual([
      { kind: 'uses_table', target: 'orders', line: 20 },
      { kind: 'calls_rpc', target: 'decrement_stock', line: 21 },
      { kind: 'calls_api', target: '/api/shipping/quote', line: 22 },
    ]);
  });

  test('syntax errors never throw', () => {
    expect(() => extractTypeScript('a.ts', 'export function ( {{{')).not.toThrow();
  });
});

test.describe('SQL extraction', () => {
  const migration = sql`-- header: create table ghost (id int);
create table if not exists public.help_articles (
  id uuid primary key,
  note text default 'create table fake (x int);'
);
/* create table commented_out (id int); */
create or replace function public.help_set_status(p_id uuid, p_to text)
returns text language plpgsql as $fn$
begin
  perform 1; -- create table inner_ghost (id int);
  return 'ok';
end $fn$;
create unique index if not exists idx_help_slug on public.help_articles(id);
create trigger help_guard before update on public.help_articles for each row execute function f();
create policy "own rows" on public.help_articles for select using (true);
create view public.help_view as select 1;
alter table public.help_articles enable row level security;
-- rollback:
-- drop table public.help_articles;
-- create table rolled_back (id int);
`;

  test('only literally named objects are reported, with exact lines', () => {
    const facts = extractSql(migration);
    expect(facts.objects.map((o) => [o.name, o.kind, o.startLine])).toEqual([
      ['help_articles', 'table', 2],
      ['help_set_status', 'sql_function', 7],
      ['idx_help_slug', 'index', 13],
      ['help_guard', 'trigger', 14],
      ['own rows', 'policy', 15],
      ['help_view', 'view', 16],
    ]);
    const fn = facts.objects.find((o) => o.name === 'help_set_status')!;
    expect(fn.endLine).toBe(12);
    expect(fn.signature).toBe('public.help_set_status(p_id uuid, p_to text) returns text');
    expect(facts.alterations).toEqual([{ table: 'help_articles', line: 17 }]);
  });

  test('comment blanking keeps line numbers and leaves strings alone', () => {
    const blanked = blankSqlComments("select 1; -- c\n/* a\nb */ select '--not a comment';");
    expect(blanked.split('\n')).toHaveLength(3);
    expect(blanked).toContain("'--not a comment'");
    expect(blanked).not.toContain('-- c');
  });
});

test.describe('Markdown extraction', () => {
  test('front matter, sections, code fences and path references', () => {
    const doc = [
      '---', 'id: help-center', 'titolo: Help Center', 'modulo: help-center', 'stato: verificata',
      'sha_verificato: 2a688bce', 'file_monitorati:', '  - apps/storefront/src/lib/helpCenter/rules.ts', '---',
      '# Help Center', 'Intro `apps/storefront/src/lib/helpCenter/rules.ts:64-78` e `resolveHelpLevel()`.',
      '## Fonti', '```', '# not a heading', '```', 'Fine.',
    ].join('\n');
    const facts = extractMarkdown('docs/engineering/modules/help-center.md', doc);
    expect(facts.frontMatter).toMatchObject({ id: 'help-center', stato: 'verificata', file_monitorati: ['apps/storefront/src/lib/helpCenter/rules.ts'] });
    expect(facts.title).toBe('Help Center');
    expect(facts.sections.map((s) => s.title)).toEqual(['Help Center', 'Help Center › Fonti']);
    expect(facts.sections[0]!.startLine).toBe(10);
    expect(facts.pathReferences).toEqual([{ path: 'apps/storefront/src/lib/helpCenter/rules.ts', line: 11 }]);
    expect(facts.identifierReferences).toEqual([{ name: 'resolveHelpLevel', line: 11 }]);
    expect(parseFrontMatter('no front matter').data).toBeNull();
  });

  test('a long section is split under the chunk limit', () => {
    const body = Array.from({ length: 200 }, (_, i) => `riga ${i} ${'x'.repeat(60)}`).join('\n');
    const facts = extractMarkdown('a.md', `# T\n${body}`);
    expect(facts.sections.length).toBeGreaterThan(2);
    expect(Math.max(...facts.sections.map((s) => s.body.length))).toBeLessThanOrEqual(4000);
  });
});

test.describe('snapshot builder', () => {
  const files: SourceFile[] = [
    { path: 'apps/storefront/src/lib/helpCenter/rules.ts', content: '/** Rules. */\nexport function resolveHelpLevel() { return 1; }\n' },
    { path: 'apps/storefront/src/lib/helpCenter/server/access.ts', content: "import { resolveHelpLevel } from '../rules';\nexport const level = resolveHelpLevel();\n" },
    { path: 'apps/storefront/src/app/api/admin/help/route.ts', content: "import { level } from '@/lib/helpCenter/server/access';\nimport { z } from 'zod';\nexport async function GET() { return db.from('help_articles'); }\n" },
    { path: 'apps/storefront/tests/unit/helpCenter.spec.ts', content: "import { test } from '@playwright/test';\nimport { resolveHelpLevel } from '../../src/lib/helpCenter/rules';\ntest('level', () => {});\n" },
    { path: 'supabase/migrations/174_help_center.sql', content: 'create table public.help_articles (id uuid);\n' },
    { path: 'supabase/tests/174_help_center.test.sql', content: 'select 1;\n' },
    { path: 'docs/HELP_CENTER.md', content: '# Help Center\nVedi `apps/storefront/src/lib/helpCenter/rules.ts` e `help_articles`.\n' },
    { path: '.env.local', content: 'SECRET=1\n' },
    { path: 'apps/storefront/src/lib/leak.ts', content: `export const k = "${FAKE.stripe}";\n` },
    { path: 'public/a.png', content: null },
    { path: 'apps/storefront/src/lib/binary.ts', content: null },
  ];
  const build = (input: SourceFile[], sha = SHA) => buildSnapshot({ repository: 'r', branch: 'main', commitSha: sha, mode: 'incremental', files: input });

  test('blob sha equals the git object id', () => {
    expect(gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  test('every relation kind is demonstrated by a file and a line', () => {
    const snapshot = build(files);
    const rel = (from: string, kind: string) => snapshot.relations.filter((r) => r.fromPath.endsWith(from) && r.kind === kind);
    expect(rel('server/access.ts', 'imports')).toEqual([expect.objectContaining({ toPath: 'apps/storefront/src/lib/helpCenter/rules.ts', evidenceLine: 1 })]);
    expect(rel('help/route.ts', 'imports').map((r) => r.toPath ?? r.targetRef).sort()).toEqual(['apps/storefront/src/lib/helpCenter/server/access.ts', 'zod']);
    expect(rel('help/route.ts', 'uses_table')).toEqual([expect.objectContaining({ targetRef: 'help_articles', evidenceLine: 3 })]);
    expect(rel('help/route.ts', 'handles_route')).toEqual([expect.objectContaining({ targetRef: '/api/admin/help' })]);
    expect(rel('helpCenter.spec.ts', 'tests')).toEqual([expect.objectContaining({ toPath: 'apps/storefront/src/lib/helpCenter/rules.ts' })]);
    expect(rel('helpCenter.spec.ts', 'imports').map((r) => r.targetRef)).toEqual(['@playwright/test']);
    expect(rel('174_help_center.test.sql', 'tests')).toEqual([expect.objectContaining({ toPath: 'supabase/migrations/174_help_center.sql' })]);
    expect(rel('174_help_center.sql', 'defines_object')).toEqual([expect.objectContaining({ targetRef: 'help_articles', evidenceLine: 1 })]);
    expect(rel('HELP_CENTER.md', 'documents')).toEqual([expect.objectContaining({ toPath: 'apps/storefront/src/lib/helpCenter/rules.ts', evidenceLine: 2 })]);
    for (const r of snapshot.relations) expect(RELATION_KINDS).toContain(r.kind);
  });

  test('excluded files leave no trace except path and rule', () => {
    const snapshot = build(files);
    expect(snapshot.excluded.map((e) => [e.path, e.reasonCode]).sort()).toEqual([
      ['.env.local', 'denied_path'],
      ['apps/storefront/src/lib/binary.ts', 'binary_content'],
      ['apps/storefront/src/lib/leak.ts', 'secret_detected'],
      ['public/a.png', 'binary_extension'],
    ]);
    const serialised = JSON.stringify(snapshot);
    expect(serialised).not.toContain(FAKE.stripe);
    expect(serialised).not.toContain('SECRET=1');
    expect(snapshot.files.some((f) => f.path.endsWith('leak.ts'))).toBe(false);
    expect(snapshot.symbols.some((s) => s.name === 'k')).toBe(false);
    expect(Object.values(snapshot.blobs).every((content) => !content.includes(FAKE.stripe))).toBe(true);
  });

  test('re-running on the same input is byte-identical, whatever the input order', () => {
    const a = JSON.stringify(build(files));
    const b = JSON.stringify(build([...files].reverse()));
    expect(b).toBe(a);
    expect(build(files).manifest.checksum).toBe(filesChecksum(build(files).files));
  });

  test('a rename and a delete are visible in the next snapshot', () => {
    const before = build(files);
    const after = build(files
      .filter((f) => f.path !== 'docs/HELP_CENTER.md')
      .map((f) => (f.path === 'apps/storefront/src/lib/helpCenter/rules.ts' ? { ...f, path: 'apps/storefront/src/lib/helpCenter/levels.ts' } : f)), '2'.repeat(40));
    expect(after.files.some((f) => f.path.endsWith('rules.ts'))).toBe(false);
    expect(after.files.some((f) => f.path.endsWith('levels.ts'))).toBe(true);
    expect(after.documents).toHaveLength(0);
    expect(after.manifest.checksum).not.toBe(before.manifest.checksum);
    // The import of the renamed file is no longer resolved: the relation disappears instead of dangling.
    expect(after.relations.some((r) => r.toPath?.endsWith('rules.ts'))).toBe(false);
    // Unchanged files keep the same blob (what makes an incremental upload cheap).
    const unchanged = (s: typeof before) => s.files.find((f) => f.path.endsWith('server/access.ts'))!.blobSha;
    expect(unchanged(after)).toBe(unchanged(before));
  });

  test('modules, symbols and chunks are attached to real positions', () => {
    const snapshot = build(files);
    expect(snapshot.files.find((f) => f.path.endsWith('rules.ts'))!.moduleKey).toBe('help-center');
    const symbol = snapshot.symbols.find((s) => s.name === 'resolveHelpLevel')!;
    expect(symbol).toMatchObject({ startLine: 2, endLine: 2, kind: 'function', exported: true });
    expect(snapshot.chunks.some((c) => c.kind === 'symbol' && c.title.startsWith('resolveHelpLevel'))).toBe(true);
    expect(snapshot.chunks.some((c) => c.kind === 'doc_section' && c.docKey === 'docs/HELP_CENTER.md')).toBe(true);
    expect(snapshot.chunks.every((c) => c.body.length <= 4000)).toBe(true);
  });

  test('a document claiming "verified" without the verified commit is demoted', () => {
    const snapshot = build([{ path: 'docs/engineering/modules/x.md', content: '---\nid: x\nstato: verificata\n---\n# X\n' }]);
    expect(snapshot.documents[0]!.reviewStatus).toBe('to_review');
    const ok = build([{ path: 'docs/engineering/modules/x.md', content: '---\nid: x\nstato: verificata\nsha_verificato: 2a688bce\n---\n# X\n' }]);
    expect(ok.documents[0]).toMatchObject({ reviewStatus: 'verified', verifiedSha: '2a688bce' });
  });
});

test.describe('migration 175 contract', () => {
  const tables = [...MIGRATION.matchAll(/create table if not exists public\.(engineering_\w+)/g)].map((m) => m[1]);

  test('every table has forced RLS, no policy and no grant to browser roles', () => {
    expect(tables.length).toBe(12);
    for (const table of tables) {
      expect(MIGRATION, table).toContain(`alter table public.${table} force row level security`);
    }
    expect(MIGRATION).not.toMatch(/create policy/i);
    expect(MIGRATION).not.toMatch(/grant [^;]*(anon|authenticated)/i);
    expect(MIGRATION).toMatch(/revoke all on public\.engineering_repositories[\s\S]*from public, anon, authenticated, service_role/);
  });

  test('no tenant column anywhere: the index is not tenant data', () => {
    expect(MIGRATION).not.toMatch(/tenant_id/);
    expect(MIGRATION).not.toMatch(/references public\.tenants/);
  });

  test('database CHECK lists mirror the TypeScript vocabulary', () => {
    const list = (column: string) => {
      const match = new RegExp(`${column}[^\\n]*check \\(${column} in \\(([^)]*)\\)`).exec(MIGRATION);
      return match ? (match[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, '')) : [];
    };
    expect(list('kind').length).toBeGreaterThan(0);
    expect(MIGRATION).toContain(`check (kind in (${FILE_KINDS.map((k) => `'${k}'`).join(', ')}))`);
    expect(MIGRATION).toContain(`check (kind in (${SYMBOL_KINDS.map((k) => `'${k}'`).join(', ')}))`);
    expect(MIGRATION).toContain(`check (kind in (${RELATION_KINDS.map((k) => `'${k}'`).join(', ')}))`);
    expect(MIGRATION).toContain(`check (review_status in (${DOC_REVIEW_STATUSES.map((k) => `'${k}'`).join(', ')}))`);
  });

  test('capabilities are seeded without any assignment beyond the IT role', () => {
    for (const key of ENGINEERING_PERMISSIONS) expect(MIGRATION).toContain(`'${key}'`);
    expect(MIGRATION).not.toMatch(/insert into public\.admin_memberships/);
    expect(MIGRATION).not.toMatch(/insert into public\.platform_plan_features|tenant_feature_overrides/);
    expect(MIGRATION).toMatch(/'engineering_member'[^)]*'platform'/);
  });

  test('activation and rollback are single-statement-group transactions on the repository row', () => {
    expect(MIGRATION).toMatch(/engineering_activate_run[\s\S]*for update[\s\S]*set active_run_id = p_run/);
    expect(MIGRATION).toContain("raise exception 'engineering_run_not_staged'");
    expect(MIGRATION).toContain("raise exception 'engineering_branch_not_activatable'");
  });

  test('CI runs the migration chain twice', () => {
    const ci = readFileSync(resolve(REPO, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain('supabase/tests/175_engineering_hub.fixture.sql');
    // twice in its own step, once more as the base of the unit C (176) chain
    expect(ci.split('supabase/migrations/175_engineering_hub.sql').length - 1).toBe(3);
    expect(ci).toContain('supabase/tests/175_engineering_hub.test.sql');
  });
});

test.describe('isolation from tenants and from the Help Center', () => {
  test('engineering is absent from the tenant RBAC route and API maps', () => {
    for (const path of ['/api/admin/platform/engineering/search', '/api/admin/engineering', '/api/engineering/v1/ask']) {
      for (const method of ['GET', 'POST']) expect(permissionForAdminApi(path, method), `${method} ${path}`).toBeNull();
    }
    expect(permissionsForAdminPath('/admin/platform/engineering', 'shop') ?? []).not.toContain('engineering.view');
    const apiMap = readFileSync(resolve(ROOT, 'src/lib/auth/adminApiPermissions.ts'), 'utf8');
    const routeMap = readFileSync(resolve(ROOT, 'src/lib/auth/adminRoutePermissions.ts'), 'utf8');
    expect(apiMap).not.toMatch(/engineering/i);
    expect(routeMap).not.toMatch(/engineering/i);
  });

  test('the legacy tenant_admin permission list never contains an engineering capability', () => {
    const rbac = readFileSync(resolve(ROOT, 'src/lib/auth/adminRbac.ts'), 'utf8');
    expect(rbac).not.toMatch(/engineering\./);
  });

  test('the Hub and the Help Center / Assistance do not import each other', () => {
    for (const file of walk(resolve(ROOT, 'src/lib/engineering')).filter((f) => f.endsWith('.ts'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]*(helpCenter|lib\/support)[^'"]*['"]/);
    }
    for (const dir of ['src/lib/helpCenter', 'src/lib/support', 'src/app/admin/_components/help', 'src/app/admin/_components/support']) {
      for (const file of walk(resolve(ROOT, dir)).filter((f) => /\.tsx?$/.test(f))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/from ['"][^'"]*lib\/engineering[^'"]*['"]/);
      }
    }
  });

  test('server code reads only the active run and the API guard is the platform-owner check', () => {
    const active = readFileSync(resolve(ROOT, 'src/lib/engineering/server/activeRun.ts'), 'utf8');
    expect(active).toContain(".eq('status', 'active')");
    const guard = readFileSync(resolve(ROOT, 'src/lib/engineering/server/guard.ts'), 'utf8');
    expect(guard).toContain('requirePlatformOwner');
    expect(guard).not.toMatch(/canAdmin|requirePermission/);
  });

  test('the indexer runs under Node type stripping: no @/ alias and no server-only import', () => {
    for (const file of walk(resolve(ROOT, 'src/lib/engineering')).filter((f) => f.endsWith('.ts') && !f.includes(`${'/'}server${'/'}`) && !f.includes('\\server\\'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/from ['"]@\//);
      expect(text, file).not.toMatch(/server-only/);
    }
  });

  test('checksum helper is the md5 of "<path> <blob>" lines in byte order', () => {
    const files = [{ path: 'b', blobSha: 'y' }, { path: 'a', blobSha: 'x' }];
    expect(filesChecksum(files)).toBe(createHash('md5').update('a x\nb y').digest('hex'));
  });
});
