/**
 * Stale-documentation check (pure): front matter validity and drift of the technical module cards.
 * Run by `pnpm engineering:docs-check` in CI. Errors fail the build; warnings are annotations.
 *
 *   error   front matter invalid, unknown module, module without a card, monitored file missing,
 *           "verificata" without owner / date / sha, or a VERIFIED card whose monitored files
 *           changed after its verified sha (it can no longer be called verified).
 *   warning a non-verified card whose monitored files changed in this PR (worth a look).
 */
import type { FrontMatter } from './indexer/markdownExtractor';
import { parseDocStatus } from './indexer/markdownExtractor';

export interface DocInput { path: string; frontMatter: FrontMatter | null }

export interface DocsCheckContext {
  moduleKeys: string[];
  /** Does the file exist at HEAD? */
  existsAtHead(path: string): boolean;
  /** Monitored files changed between `sha` and HEAD, or null when `sha` is not a known commit. */
  changedSince(sha: string, files: string[]): string[] | null;
  /** Files changed by the pull request under review (empty outside a PR). */
  prChanged: string[];
}

export interface DocsFinding { level: 'error' | 'warning'; path: string; message: string }

export function checkDocs(docs: DocInput[], ctx: DocsCheckContext): DocsFinding[] {
  const findings: DocsFinding[] = [];
  const add = (level: DocsFinding['level'], path: string, message: string) => findings.push({ level, path, message });
  const covered = new Set<string>();

  for (const doc of docs) {
    const meta = doc.frontMatter;
    if (!meta) { add('error', doc.path, 'manca il front matter (id, titolo, modulo, stato…)'); continue; }
    if (!meta.id || !/^eng-module-[a-z0-9-]+$/.test(meta.id)) add('error', doc.path, '`id` mancante o non nel formato eng-module-<modulo>');
    if (!meta.modulo || !ctx.moduleKeys.includes(meta.modulo)) add('error', doc.path, `\`modulo\` sconosciuto (${meta.modulo ?? 'assente'}): non è nel registro dei moduli`);
    else covered.add(meta.modulo);

    const status = parseDocStatus(meta.stato);
    const monitored = meta.file_monitorati ?? [];
    for (const file of monitored) if (!ctx.existsAtHead(file)) add('error', doc.path, `file monitorato non più presente: ${file}`);

    if (status === 'verified') {
      if (!meta.owner) add('error', doc.path, '«verificata» richiede `owner`');
      if (!meta.data_verifica) add('error', doc.path, '«verificata» richiede `data_verifica`');
      if (!meta.sha_verificato || !/^[0-9a-f]{7,40}$/.test(meta.sha_verificato)) {
        add('error', doc.path, '«verificata» richiede `sha_verificato` valido');
      } else {
        const changed = ctx.changedSince(meta.sha_verificato, monitored.filter((file) => ctx.existsAtHead(file)));
        if (changed === null) add('error', doc.path, `\`sha_verificato\` ${meta.sha_verificato} non è un commit noto`);
        else if (changed.length > 0) add('error', doc.path, `verificata a ${meta.sha_verificato.slice(0, 8)} ma sono cambiati: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ` (+${changed.length - 5})` : ''}. Rileggila e aggiorna \`sha_verificato\`, oppure portala a «Da revisionare»`);
      }
    } else {
      const touched = monitored.filter((file) => ctx.prChanged.includes(file));
      if (touched.length > 0) add('warning', doc.path, `questa PR modifica file monitorati dalla scheda: ${touched.slice(0, 5).join(', ')}. Controlla che la scheda sia ancora vera`);
    }
  }

  for (const key of ctx.moduleKeys) if (!covered.has(key)) add('error', 'docs/engineering/modules', `il modulo «${key}» è nel registro ma non ha una scheda`);
  return findings;
}

/** GitHub Actions annotation line. */
export function toAnnotation(finding: DocsFinding): string {
  const message = finding.message.replace(/[\r\n%]/g, ' ');
  return `::${finding.level} file=${finding.path}::${message}`;
}
