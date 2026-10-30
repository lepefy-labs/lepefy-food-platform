/**
 * Shared by `engineering-index` and `engineering-sync`: builds the snapshot of a Git ref from
 * COMMITTED content only (ls-tree + cat-file), never from the working tree.
 */
import { execFileSync } from 'node:child_process';
import { buildSnapshot, type SourceFile } from '../src/lib/engineering/indexer/buildSnapshot';
import { exclusionForPath } from '../src/lib/engineering/exclusions';

export function git(root: string, args: string[], input?: Buffer): Buffer {
  return execFileSync('git', args, { cwd: root, input, maxBuffer: 512 * 1024 * 1024 });
}

export function repoRoot(): string {
  return git(process.cwd(), ['rev-parse', '--show-toplevel']).toString('utf8').trim();
}

export function snapshotFromGit(options: { root: string; ref: string; branch: string; mode: 'full' | 'incremental' }) {
  const { root, ref, branch, mode } = options;
  const commitSha = git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).toString('utf8').trim();

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
  return { commitSha, snapshot: buildSnapshot({ repository: 'lepefy-food-platform', branch, commitSha, mode, files }) };
}
