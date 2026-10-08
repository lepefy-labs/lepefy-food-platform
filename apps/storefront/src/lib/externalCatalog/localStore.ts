import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_FILES, safeArtifactPath } from './artifacts';
import { renderReportHtml } from './report';
import type { RunReport } from './report';
import { mergeDecisions, parseReviewDecisions } from './reviewDecisions';
import type { ExternalProductReviewDecision, NormalizedExternalProduct } from './types';

/**
 * Lettura/scrittura degli artefatti locali (CLI + server di revisione).
 * Ogni scrittura passa da `safeArtifactPath` e da un redattore di segreti.
 */

export type Redactor = (text: string) => string;

export async function writeArtifact(root: string, relative: string, data: string | Uint8Array, redact?: Redactor): Promise<void> {
  const full = safeArtifactPath(root, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, typeof data === 'string' && redact ? redact(data) : data);
}

export async function writeJsonArtifact(root: string, relative: string, value: unknown, redact?: Redactor): Promise<void> {
  await writeArtifact(root, relative, `${JSON.stringify(value, null, 2)}\n`, redact);
}

export async function readJsonArtifact<T = unknown>(root: string, relative: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(safeArtifactPath(root, relative), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function loadDecisions(root: string, products: NormalizedExternalProduct[], now: string): Promise<ExternalProductReviewDecision[]> {
  const raw = await readJsonArtifact(root, ARTIFACT_FILES.decisions);
  const known = new Set(products.map((p) => p.source_product_id));
  const saved = raw ? parseReviewDecisions(raw, known) : new Map<string, ExternalProductReviewDecision>();
  return mergeDecisions(products, saved, now);
}

/** Rigenera report.html dai file correnti (dopo una nuova lettura o una revisione). */
export async function renderReportFromArtifacts(root: string, now: string): Promise<string | null> {
  const report = await readJsonArtifact<RunReport>(root, ARTIFACT_FILES.reportJson);
  if (!report) return null;
  const products = (await readJsonArtifact<NormalizedExternalProduct[]>(root, ARTIFACT_FILES.normalized)) ?? [];
  const decisions = await loadDecisions(root, products, now);
  const html = renderReportHtml(report, products, decisions);
  await writeArtifact(root, ARTIFACT_FILES.reportHtml, html);
  return html;
}
