/**
 * Engineering Hub: build the technical index snapshot of a Git ref (docs/engineering/INDEXING.md).
 *
 *   pnpm engineering:index [--ref HEAD] [--branch main] [--mode incremental|full] [--out artifacts/engineering/snapshot.json]
 *
 * Reads only committed content through git (never the working tree), writes only the
 * git-ignored output file. No network, no Supabase, no environment variable: uploading a
 * snapshot is a separate, authenticated step (unit D).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { repoRoot, snapshotFromGit } from './engineeringGit';

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return (index !== -1 ? process.argv[index + 1] : undefined) || fallback;
}

const ref = arg('ref', 'HEAD');
const branch = arg('branch', 'main');
const mode = arg('mode', 'incremental') === 'full' ? 'full' : 'incremental';
const root = repoRoot();
const { commitSha, snapshot } = snapshotFromGit({ root, ref, branch, mode });
const out = resolve(root, arg('out', 'artifacts/engineering/snapshot.json'));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(snapshot));

const byReason: Record<string, number> = {};
for (const item of snapshot.excluded) byReason[item.reasonCode] = (byReason[item.reasonCode] ?? 0) + 1;
console.log(JSON.stringify({
  commitSha, branch, mode, manifest: snapshot.manifest, excludedByReason: byReason,
  excludedForContent: snapshot.excluded.filter((item) => ['secret_detected', 'personal_data', 'too_large', 'binary_content'].includes(item.reasonCode)),
  diagnostics: snapshot.diagnostics, out,
}, null, 2));
