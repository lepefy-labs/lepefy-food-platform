/**
 * Engineering Hub: build the technical index snapshot of a Git ref (docs/engineering/INDEXING.md).
 *
 *   pnpm engineering:index [--ref HEAD] [--branch main] [--mode incremental|full] [--out artifacts/engineering/snapshot.json]
 *
 * Reads only committed content through git (never the working tree), writes only the
 * git-ignored output file. No network, no Supabase, no environment variable: uploading a
 * snapshot is a separate, authenticated step (unit D).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildSnapshot, type SourceFile } from '../src/lib/engineering/indexer/buildSnapshot';
import { exclusionForPath } from '../src/lib/engineering/exclusions';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return (index !== -1 ? process.argv[index + 1] : undefined) || fallback;
}

function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 512 * 1024 * 1024 });
}

const ref = arg('ref', 'HEAD');
const branch = arg('branch', 'main');
const mode = arg('mode', 'incremental') === 'full' ? 'full' : 'incremental';
const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).toString('utf8').trim();
const commitSha = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).toString('utf8').trim();
const out = resolve(root, arg('out', 'artifacts/engineering/snapshot.json'));

// Tree entries: "<mode> blob <sha>\t<path>", NUL separated.
const entries = git(root, ['ls-tree', '-r', '-z', '--full-tree', commitSha]).toString('utf8').split('\0').filter(Boolean)
  .map((line) => {
    const tab = line.indexOf('\t');
    const [, type, sha] = line.slice(0, tab).split(' ');
    return { type, sha, path: line.slice(tab + 1) };
  })
  .filter((entry) => entry.type === 'blob');

// Content is read only for paths the path rules allow; the others are recorded as excluded without being read.
const toRead = entries.filter((entry) => exclusionForPath(entry.path) === null);
const batch = git(root, ['cat-file', '--batch'], Buffer.from(toRead.map((entry) => `${entry.sha}\n`).join('')));
const contents = new Map<string, string | null>();
let offset = 0;
for (const entry of toRead) {
  const newline = batch.indexOf(0x0a, offset);
  const [, , size] = batch.subarray(offset, newline).toString('utf8').split(' ');
  const length = Number(size);
  const bytes = batch.subarray(newline + 1, newline + 1 + length);
  contents.set(entry.path, bytes.includes(0) ? null : bytes.toString('utf8'));
  offset = newline + 1 + length + 1;
}

const files: SourceFile[] = entries.map((entry) => ({ path: entry.path, content: contents.has(entry.path) ? contents.get(entry.path)! : '' }));
const snapshot = buildSnapshot({ repository: 'lepefy-food-platform', branch, commitSha, mode, files });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));

const byReason: Record<string, number> = {};
for (const item of snapshot.excluded) byReason[item.reasonCode] = (byReason[item.reasonCode] ?? 0) + 1;
console.log(JSON.stringify({
  commitSha, branch, mode, manifest: snapshot.manifest, excludedByReason: byReason,
  excludedForContent: snapshot.excluded.filter((item) => ['secret_detected', 'personal_data', 'too_large', 'binary_content'].includes(item.reasonCode)),
  diagnostics: snapshot.diagnostics, out,
}, null, 2));
