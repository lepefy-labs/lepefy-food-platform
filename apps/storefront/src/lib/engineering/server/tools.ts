import 'server-only';
import { ENGINEERING_MODULES } from '../moduleRegistry';
import { sanitizeRepoPath } from '../explorer';
import { ASK_LIMITS, type AiTool, type EvidenceLedger, type PlannerStep } from '../ai/contract';
import { ToolInputError } from '../ai/orchestrator';
import { escapeLike } from '../search/contract';
import type { ActiveRun } from './activeRun';
import { loadDocuments, loadFileSource, loadFiles, loadReferencesTo } from './repository';
import { searchEngineering } from './search';

const MODULE_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const REGISTRY_PATH = 'apps/storefront/src/lib/engineering/moduleRegistry.ts';
const EXCERPT_LINES = 40;

/** Reads at most `maxLines` lines of an indexed file. Excluded files have no source and return null. */
async function excerpt(run: ActiveRun, cache: Map<string, string[] | null>, path: string, start: number, end: number, maxLines: number): Promise<{ text: string; from: number; to: number } | null> {
  let lines = cache.get(path);
  if (lines === undefined) {
    const source = await loadFileSource(run.repositoryId, run.runId, path);
    lines = source ? source.content.split('\n') : null;
    cache.set(path, lines);
  }
  if (!lines) return null;
  const from = Math.max(1, Math.min(start, lines.length));
  const to = Math.max(from, Math.min(end, lines.length, from + maxLines - 1));
  return { text: lines.slice(from - 1, to).join('\n'), from, to };
}

/**
 * The only tools the model can trigger. Each one reads the ACTIVE run only, has bounded output
 * and registers what it found as evidence; none writes, none reaches the network or the tenants.
 */
export function createToolRunner(run: ActiveRun) {
  const sources = new Map<string, string[] | null>();

  return async function runTool(tool: AiTool, step: PlannerStep, ledger: EvidenceLedger): Promise<string> {
    if (tool === 'search') {
      if (!step.query || step.query.length < 2) throw new ToolInputError('query');
      const moduleKey = step.module && MODULE_KEY.test(step.module) ? step.module : null;
      const outcome = await searchEngineering({ query: step.query, moduleKey });
      if (outcome.state !== 'ok') return `search "${step.query}": indice non disponibile`;
      let added = 0;
      for (const hit of outcome.hits.slice(0, 6)) {
        let text = hit.snippet ?? hit.title;
        let from = hit.startLine;
        let to = hit.endLine;
        if (hit.startLine && (hit.kind === 'symbol' || hit.kind === 'chunk')) {
          const code = await excerpt(run, sources, hit.path, hit.startLine, hit.endLine ?? hit.startLine, EXCERPT_LINES);
          if (code) { text = code.text; from = code.from; to = code.to; }
        }
        if (ledger.add({ path: hit.path, startLine: from, endLine: to, label: `${hit.kind}:${hit.title}`, text })) added += 1;
      }
      return `search "${step.query}"${moduleKey ? ` in ${moduleKey}` : ''}: ${outcome.total} risultati, ${added} prove aggiunte`;
    }

    if (tool === 'read_file') {
      const path = sanitizeRepoPath(step.path);
      if (!path) throw new ToolInputError('path');
      const files = await loadFiles(run.runId);
      if (!files.some((file) => file.path === path)) throw new ToolInputError('file_not_indexed');
      const start = step.startLine ?? 1;
      const code = await excerpt(run, sources, path, start, step.endLine ?? start + ASK_LIMITS.maxReadLines - 1, ASK_LIMITS.maxReadLines);
      if (!code) throw new ToolInputError('no_source');
      ledger.add({ path, startLine: code.from, endLine: code.to, label: 'file', text: code.text });
      return `read_file ${path}:${code.from}-${code.to}`;
    }

    if (tool === 'list_module') {
      const key = step.module ?? step.name;
      const entry = key && MODULE_KEY.test(key) ? ENGINEERING_MODULES.find((candidate) => candidate.moduleKey === key) : undefined;
      if (!entry) throw new ToolInputError('module');
      const [files, documents] = await Promise.all([loadFiles(run.runId), loadDocuments(run.runId)]);
      const own = files.filter((file) => file.moduleKey === entry.moduleKey);
      const byKind = new Map<string, number>();
      for (const file of own) byKind.set(file.kind, (byKind.get(file.kind) ?? 0) + 1);
      ledger.add({
        path: REGISTRY_PATH, startLine: null, endLine: null, label: `module:${entry.moduleKey}`,
        text: `${entry.title} (${entry.category}): ${entry.summary}\nFile: ${own.length}. ${[...byKind].map(([kind, count]) => `${kind} ${count}`).join(', ')}\nPercorsi: ${entry.pathGlobs.slice(0, 12).join(', ')}`,
      });
      for (const doc of documents.filter((candidate) => candidate.moduleKey === entry.moduleKey).slice(0, 4)) {
        const code = await excerpt(run, sources, doc.path, 1, 60, 60);
        if (code) ledger.add({ path: doc.path, startLine: code.from, endLine: code.to, label: `doc:${doc.title}`, text: code.text });
      }
      return `list_module ${entry.moduleKey}: ${own.length} file`;
    }

    // find_references
    if (!step.name || step.name.length < 2) throw new ToolInputError('name');
    const refs = await loadReferencesTo(run.runId, escapeLike(step.name));
    const files = await loadFiles(run.runId);
    const byId = new Map(files.map((file) => [file.id, file.path]));
    let added = 0;
    for (const ref of refs.slice(0, 8)) {
      const path = byId.get(ref.fromFileId);
      if (!path) continue;
      const around = ref.evidenceLine ? await excerpt(run, sources, path, Math.max(1, ref.evidenceLine - 2), ref.evidenceLine + 3, 6) : null;
      if (ledger.add({ path, startLine: around?.from ?? ref.evidenceLine, endLine: around?.to ?? ref.evidenceLine, label: `${ref.kind}:${ref.targetRef}`, text: around?.text ?? `${ref.kind} ${ref.targetRef}` })) added += 1;
    }
    return `find_references "${step.name}": ${refs.length} file, ${added} prove aggiunte`;
  };
}
