import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildTsQuery, containsAllTokens, escapeLike, makeSnippet, mergeHits, normalizeQuery, pickToolHits, queryTokens, scoreHit, validateQuery, wordTokens, type SearchHit,
} from '../../src/lib/engineering/search/contract';
import {
  docNeedsRecheck, listDirectory, moduleDependencies, moduleDocStatus, parentDirectory, sameCommit, sanitizeRepoPath, summarizeModule, topLevelAreas,
  type DocumentRow, type FileRow,
} from '../../src/lib/engineering/explorer';
import { ENGINEERING_MODULES } from '../../src/lib/engineering/moduleRegistry';
import { extractMarkdown } from '../../src/lib/engineering/indexer/markdownExtractor';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { PLATFORM_NAV } from '../../src/app/admin/_components/platformNavConfig';

const REPO = resolve(__dirname, '../../../..');
const ROOT = resolve(REPO, 'apps/storefront');

function hit(partial: Partial<SearchHit> & Pick<SearchHit, 'key' | 'score'>): SearchHit {
  return { kind: 'symbol', stage: 'exact', title: 't', path: 'a.ts', startLine: 1, endLine: 2, moduleKey: null, detail: null, snippet: null, ...partial };
}

test.describe('search contract', () => {
  test('multi-word queries match identifiers and paths word by word', () => {
    expect(buildTsQuery('purchase quantity', 'or')).toBe('purchase:* | quantity:*');
    expect(wordTokens('purchase quantity rules')).toEqual(['purchase', 'quantity', 'rules']);
    expect(wordTokens('validateCheckoutItems')).toEqual([]);
    expect(containsAllTokens('apps/storefront/src/lib/purchaseQuantityRules.ts', ['purchase', 'quantity'])).toBe(true);
    expect(containsAllTokens('apps/storefront/src/lib/cart/cartStore.ts', ['purchase', 'quantity'])).toBe(false);
    expect(containsAllTokens('a.ts', [])).toBe(false);
  });

  test('AI tools prefer code over prose but keep prose as a fallback', () => {
    const code = (n: number) => hit({ key: `c${n}`, score: 40 - n, path: `src/lib/f${n}.ts`, kind: 'symbol' });
    const doc = (n: number) => hit({ key: `d${n}`, score: 60 - n, path: `docs/D${n}.md`, kind: 'chunk', detail: 'doc' });
    const mixed = [doc(1), doc(2), doc(3), doc(4), code(1), code(2), code(3), code(4), code(5)];
    const picked = pickToolHits(mixed, 6).map((entry) => entry.key);
    expect(picked.filter((key) => key.startsWith('c')).length).toBeGreaterThanOrEqual(4);
    expect(picked.length).toBe(6);
    expect(pickToolHits([doc(1), doc(2)], 6).map((entry) => entry.key)).toEqual(['d1', 'd2']);
    expect(pickToolHits([code(1), code(2), code(3)], 2).length).toBe(2);
  });

  test('queries are normalized, bounded and validated', () => {
    expect(normalizeQuery('  foo \n\t bar\u0000 ')).toBe('foo bar');
    expect(normalizeQuery(42)).toBe('');
    expect(normalizeQuery('x'.repeat(500)).length).toBe(120);
    expect(validateQuery('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateQuery('a')).toEqual({ ok: false, reason: 'too_short' });
    expect(validateQuery(' ab ')).toEqual({ ok: true, query: 'ab' });
  });

  test('LIKE wildcards in user text are matched literally', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  test('the tsquery carries no operators, only prefix terms ANDed', () => {
    expect(buildTsQuery('validate Checkout')).toBe('validate:* & checkout:*');
    expect(buildTsQuery("a'; drop table x; --")).not.toMatch(/[';|!()<>]/);
    expect(buildTsQuery('& | ! ( ) :*')).toBeNull();
    expect(buildTsQuery('commandé élan')).toBe('commande:* & elan:*');
    expect(queryTokens('a b cc').sort()).toEqual(['cc']);
  });

  test('stage strength always dominates: a weaker stage never outranks a stronger one', () => {
    const strongestFuzzy = scoreHit({ stage: 'fuzzy', kind: 'document', exported: true, isDoc: true });
    const weakestPrefix = scoreHit({ stage: 'prefix', kind: 'symbol', isTest: true });
    expect(weakestPrefix).toBeGreaterThan(strongestFuzzy);
    const strongestPrefix = scoreHit({ stage: 'prefix', kind: 'document', exported: true, isDoc: true });
    expect(scoreHit({ stage: 'exact', kind: 'symbol', isTest: true })).toBeGreaterThan(strongestPrefix);
    expect(scoreHit({ stage: 'fulltext', kind: 'chunk' })).toBeGreaterThan(strongestFuzzy);
  });

  test('merge keeps the best hit per identity, orders deterministically and caps', () => {
    const merged = mergeHits([
      [hit({ key: 'a', score: 30, stage: 'fuzzy', path: 'm.ts' }), hit({ key: 'b', score: 100, path: 'b.ts' })],
      [hit({ key: 'a', score: 70, stage: 'prefix', path: 'm.ts' }), hit({ key: 'c', score: 70, path: 'a0.ts' })],
    ], 2);
    expect(merged.total).toBe(3);
    expect(merged.hits.map((entry) => entry.key)).toEqual(['b', 'c']);
    expect(mergeHits([[hit({ key: 'a', score: 70, stage: 'prefix' })], [hit({ key: 'a', score: 30, stage: 'fuzzy' })]]).hits[0]?.stage).toBe('prefix');
    const reversed = mergeHits([[hit({ key: 'z', score: 50, path: 'z.ts' }), hit({ key: 'y', score: 50, path: 'y.ts' })]]).hits.map((entry) => entry.key);
    expect(reversed).toEqual(['y', 'z']);
  });

  test('snippets are centred on the first matched term and bounded', () => {
    const body = `${'intro '.repeat(40)}the checkout validator runs here ${'tail '.repeat(60)}`;
    const snippet = makeSnippet(body, 'validator');
    expect(snippet).toContain('validator');
    expect(snippet.length).toBeLessThanOrEqual(230);
    expect(makeSnippet('', 'x')).toBe('');
  });
});

const file = (id: string, path: string, kind: FileRow['kind'] = 'source', moduleKey: string | null = null, lineCount = 10): FileRow =>
  ({ id, path, kind, moduleKey, sizeBytes: 100, lineCount });

test.describe('explorer derivations', () => {
  const files = [
    file('1', 'apps/storefront/src/lib/orders/a.ts', 'source', 'orders'),
    file('2', 'apps/storefront/src/app/api/checkout/route.ts', 'api_route', 'payments'),
    file('3', 'apps/storefront/src/app/api/orders/route.ts', 'api_route', 'orders'),
    file('4', 'supabase/migrations/001_a.sql', 'migration'),
    file('5', 'README.md', 'doc'),
  ];

  test('module stats count by kind and never invent documentation', () => {
    const stats = summarizeModule('orders', files, []);
    expect(stats.files).toBe(2);
    expect(stats.apiRoutes).toBe(1);
    expect(moduleDocStatus(stats.documents)).toEqual({ status: 'none', label: 'Nessun documento' });
  });

  test('the weakest document status wins for a module', () => {
    const doc = (reviewStatus: DocumentRow['reviewStatus']): DocumentRow => ({ docKey: reviewStatus, title: 't', path: 'p', moduleKey: 'm', reviewStatus, verifiedSha: null });
    expect(moduleDocStatus([doc('verified'), doc('partial')]).status).toBe('partial');
    expect(moduleDocStatus([doc('verified'), doc('to_review')]).status).toBe('to_review');
    expect(moduleDocStatus([doc('verified')]).status).toBe('verified');
  });

  test('module dependencies count only cross-module imports between indexed, assigned files', () => {
    const byId = new Map(files.map((entry) => [entry.id, entry]));
    const deps = moduleDependencies([
      { fromFileId: '1', toFileId: '2' }, { fromFileId: '3', toFileId: '2' }, { fromFileId: '1', toFileId: '3' },
      { fromFileId: '1', toFileId: '4' }, { fromFileId: '1', toFileId: 'missing' },
    ], byId);
    expect(deps).toEqual([{ from: 'orders', to: 'payments', imports: 2 }]);
  });

  test('directory listing is direct children only, sorted', () => {
    const root = listDirectory(files, '');
    expect(root.directories.map((entry) => entry.name)).toEqual(['apps', 'supabase']);
    expect(root.files.map((entry) => entry.path)).toEqual(['README.md']);
    const api = listDirectory(files, 'apps/storefront/src/app/api');
    expect(api.directories.map((entry) => entry.name)).toEqual(['checkout', 'orders']);
    expect(topLevelAreas(files)[0]?.path).toContain('apps/storefront/src/');
    expect(parentDirectory('a/b/c.ts')).toBe('a/b');
    expect(parentDirectory('c.ts')).toBe('');
  });

  test('repository paths from the URL are sanitized against traversal', () => {
    expect(sanitizeRepoPath('apps/storefront/x.ts')).toBe('apps/storefront/x.ts');
    expect(sanitizeRepoPath('/apps//x.ts')).toBe('');
    expect(sanitizeRepoPath('../../etc/passwd')).toBe('');
    expect(sanitizeRepoPath('a/./b')).toBe('');
    expect(sanitizeRepoPath('a\\..\\b')).toBe('');
    expect(sanitizeRepoPath('a/b\u0000')).toBe('');
    expect(sanitizeRepoPath('x'.repeat(501))).toBe('');
    expect(sanitizeRepoPath(['a'])).toBe('');
  });

  test('a verified document needs a re-check when its sha is not the indexed commit', () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    expect(sameCommit('abcdef1', sha)).toBe(true);
    expect(sameCommit('abc', sha)).toBe(false);
    expect(docNeedsRecheck({ reviewStatus: 'verified', verifiedSha: 'abcdef1' }, sha)).toBe(false);
    expect(docNeedsRecheck({ reviewStatus: 'verified', verifiedSha: '1234567' }, sha)).toBe(true);
    expect(docNeedsRecheck({ reviewStatus: 'partial', verifiedSha: null }, sha)).toBe(false);
  });
});

test.describe('unit B surface', () => {
  test('the Hub API is not mapped to a tenant permission and every route is guarded', () => {
    expect(permissionForAdminApi('/api/admin/platform/engineering/search', 'GET')).toBeNull();
    const route = readFileSync(join(ROOT, 'src/app/api/admin/platform/engineering/search/route.ts'), 'utf8');
    expect(route).toContain('requireEngineeringApi');
    expect(route).not.toMatch(/tenant/i);
  });

  test('the navigation entry exists and the pages are under the platform layout', () => {
    expect(PLATFORM_NAV.some((entry) => entry.href === '/admin/platform/engineering')).toBe(true);
    for (const page of ['page.tsx', 'architettura/page.tsx', 'moduli/page.tsx', 'moduli/[key]/page.tsx', 'codice/page.tsx', 'ricerca/page.tsx']) {
      const text = readFileSync(join(ROOT, 'src/app/admin/(protected)/platform/engineering', page), 'utf8');
      expect(text, page).toContain('getActiveRun');
      expect(text, page).not.toMatch(/getTenant|tenant_id/);
    }
  });

  test('the server reads are scoped by run and never select from tenant tables', () => {
    const text = readFileSync(join(ROOT, 'src/lib/engineering/server/repository.ts'), 'utf8');
    expect(text.match(/\.from\('([a-z_]+)'\)/g)?.every((match) => match.includes('engineering_'))).toBe(true);
    for (const table of ['engineering_files', 'engineering_documents', 'engineering_modules', 'engineering_relations', 'engineering_symbols']) {
      expect(text).toContain(table);
    }
    expect(text).not.toMatch(/\.from\('engineering_(files|symbols|relations|documents|chunks|modules|excluded_files)'\)(?:(?!run_id)[\s\S]){0,200}?\.limit/);
  });
});

test.describe('module documents', () => {
  const dir = join(REPO, 'docs/engineering/modules');
  const docs = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.md')) : [];

  test('every registered module has a document, and no document is orphaned', () => {
    expect(docs.map((name) => name.replace(/\.md$/, '')).sort()).toEqual(ENGINEERING_MODULES.map((entry) => entry.moduleKey).sort());
  });

  for (const name of docs) {
    test(`${name}: valid front matter, honest status, existing monitored files`, () => {
      const content = readFileSync(join(dir, name), 'utf8');
      const facts = extractMarkdown(`docs/engineering/modules/${name}`, content);
      const meta = facts.frontMatter;
      expect(meta, 'front matter').not.toBeNull();
      expect(meta?.modulo).toBe(name.replace(/\.md$/, ''));
      expect(meta?.id).toMatch(/^eng-module-[a-z0-9-]+$/);
      // A document is never born "verified": that state comes from a human review bound to a sha.
      expect(meta?.stato).toMatch(/^(inventariato|parziale)$/);
      expect(meta?.sha_verificato).toBeUndefined();
      for (const monitored of meta?.file_monitorati ?? []) expect(existsSync(join(REPO, monitored)), monitored).toBe(true);
      for (const reference of facts.pathReferences) {
        if (reference.path.startsWith('apps/') || reference.path.startsWith('docs/') || reference.path.startsWith('supabase/')) {
          expect(existsSync(join(REPO, reference.path)) || /[*<>{]/.test(reference.path), `${name} → ${reference.path}`).toBe(true);
        }
      }
    });
  }
});
