/**
 * Engineering Hub: stale-documentation check for docs/engineering/modules (CI).
 *
 *   pnpm engineering:docs-check [--base origin/main]
 *
 * Reads committed files only (the checkout), uses git to compare a verified card's sha with HEAD.
 * No network, no database, no environment variable. Exit 1 when there is at least one error.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINEERING_MODULES } from '../src/lib/engineering/moduleRegistry';
import { parseFrontMatter } from '../src/lib/engineering/indexer/markdownExtractor';
import { checkDocs, toAnnotation } from '../src/lib/engineering/docsCheck';
import { repoRoot } from './engineeringGit';

const root = repoRoot();
const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const baseIndex = process.argv.indexOf('--base');
const base = baseIndex !== -1 ? process.argv[baseIndex + 1] : undefined;

let prChanged: string[] = [];
if (base) {
  try { prChanged = git(['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean); } catch { /* shallow clone without the base: warnings are skipped */ }
}

const dir = join(root, 'docs/engineering/modules');
const docs = (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.md')).sort() : []).map((name) => ({
  path: `docs/engineering/modules/${name}`,
  frontMatter: parseFrontMatter(readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n')).data,
}));

const findings = checkDocs(docs, {
  moduleKeys: ENGINEERING_MODULES.map((entry) => entry.moduleKey),
  existsAtHead: (path) => existsSync(join(root, path)),
  changedSince: (sha, files) => {
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
      return files.length === 0 ? [] : git(['diff', '--name-only', sha, 'HEAD', '--', ...files]).split('\n').filter(Boolean);
    } catch { return null; }
  },
  prChanged,
});

for (const finding of findings) console.log(toAnnotation(finding));
const errors = findings.filter((finding) => finding.level === 'error').length;
console.log(`[engineering-docs-check] ${docs.length} schede, ${errors} errori, ${findings.length - errors} avvisi`);
process.exit(errors > 0 ? 1 : 0);
