import path from 'node:path';

/**
 * Isolamento degli artefatti locali: tutto ciò che la CLI e il server di
 * revisione scrivono resta sotto `<repo>/artifacts/whatsapp-catalog/`
 * (ignorato da git). Nessun percorso fornito dall'esterno può uscirne.
 */

export const ARTIFACTS_RELATIVE_ROOT = path.join('artifacts', 'whatsapp-catalog');

export const ARTIFACT_FILES = {
  raw: 'raw/catalog.json',
  normalized: 'normalized/products.json',
  imagesManifest: 'images/manifest.json',
  reportJson: 'report.json',
  reportHtml: 'report.html',
  decisions: 'review/decisions.json',
} as const;

export function resolveArtifactsRoot(repoRoot: string, outArg?: string | null): string {
  const base = path.resolve(repoRoot, ARTIFACTS_RELATIVE_ROOT);
  if (!outArg) return base;
  const candidate = path.resolve(repoRoot, outArg);
  if (!isInside(base, candidate)) {
    throw new Error(`--out deve restare sotto ${ARTIFACTS_RELATIVE_ROOT}.`);
  }
  return candidate;
}

export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Unisce un percorso relativo alla radice degli artefatti rifiutando traversal e percorsi assoluti. */
export function safeArtifactPath(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Percorso artefatto non valido.');
  const full = path.resolve(root, relative);
  if (!isInside(root, full) || full === path.resolve(root)) throw new Error('Percorso artefatto fuori dalla radice.');
  return full;
}
