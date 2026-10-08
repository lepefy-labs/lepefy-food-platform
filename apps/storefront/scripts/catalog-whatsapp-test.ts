/**
 * Ciclo sperimentale: lettura di un catalogo WhatsApp Business esterno,
 * normalizzazione, interpretazione delle quantità, staging immagini, report.
 * Cf. docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md.
 *
 *   pnpm catalog:whatsapp:test --url https://wa.me/c/191701838729307 --limit 10
 *   pnpm catalog:whatsapp:test --url … --dry-run      # nessuna scrittura su disco
 *   pnpm catalog:whatsapp:test --url … --no-images    # nessun download immagini
 *   pnpm catalog:whatsapp:test --url … --from-raw     # rielabora l'ultima lettura reale (raw/catalog.json), nessuna chiamata al provider
 *
 * Non tocca MAI Supabase, lo storage del tenant né i prodotti esistenti: scrive
 * soltanto sotto artifacts/whatsapp-catalog/ (ignorato da git). Non invia
 * messaggi WhatsApp. Non esiste alcuna modalità con dati d'esempio: se il
 * provider non restituisce il catalogo, la CLI produce una diagnosi ed esce.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isValidPhoneNumber } from 'libphonenumber-js';
import { ARTIFACT_FILES, resolveArtifactsRoot } from '../src/lib/externalCatalog/artifacts';
import { createImageStager, DEFAULT_IMAGE_HOST_SUFFIXES } from '../src/lib/externalCatalog/imageStaging';
import { loadDecisions, readJsonArtifact, writeArtifact, writeJsonArtifact } from '../src/lib/externalCatalog/localStore';
import { normalizeExternalProduct } from '../src/lib/externalCatalog/normalizeProduct';
import { getExternalCatalogProvider } from '../src/lib/externalCatalog/providers';
import { collectGreenApiProducts, GREEN_API_MAX_PRODUCT_LIMIT, redactSecrets } from '../src/lib/externalCatalog/providers/greenApi';
import { buildRunReport, renderReportHtml } from '../src/lib/externalCatalog/report';
import type { RunReport } from '../src/lib/externalCatalog/report';
import { parseWhatsAppCatalogUrl } from '../src/lib/externalCatalog/sourceUrl';
import type { ExternalCatalogDiagnostic, ExternalCatalogPage, ExternalCatalogReadStats, ExternalCatalogResult, ExternalCatalogSource, NormalizedExternalProduct, ReadCompleteness } from '../src/lib/externalCatalog/types';
import { ExternalCatalogError } from '../src/lib/externalCatalog/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');

function usage(): never {
  console.error('Uso: pnpm catalog:whatsapp:test --url https://wa.me/c/<id> [--chat-id <numero>@c.us] [--limit 500] [--dry-run] [--no-images] [--no-collections] [--page-delay-ms 1000] [--from-raw] [--timeout-ms 20000]');
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    url: { type: 'string' },
    limit: { type: 'string', default: String(GREEN_API_MAX_PRODUCT_LIMIT) },
    'no-collections': { type: 'boolean', default: false },
    'page-delay-ms': { type: 'string', default: '1000' },
    'dry-run': { type: 'boolean', default: false },
    'no-images': { type: 'boolean', default: false },
    'from-raw': { type: 'boolean', default: false },
    'chat-id': { type: 'string' },
    'timeout-ms': { type: 'string', default: '20000' },
    out: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help || !values.url) usage();
const limit = Number(values.limit);
const timeoutMs = Number(values['timeout-ms']);
if (!Number.isInteger(limit) || limit < 1 || limit > GREEN_API_MAX_PRODUCT_LIMIT) {
  console.error(`--limit deve essere un intero tra 1 e ${GREEN_API_MAX_PRODUCT_LIMIT}.`);
  process.exit(1);
}
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
  console.error('--timeout-ms deve essere tra 1000 e 120000.');
  process.exit(1);
}
const dryRun = values['dry-run'];
const withImages = !values['no-images'];
const outRoot = resolveArtifactsRoot(REPO_ROOT, values.out ?? null);

// Tutti i valori segreti noti vengono rimossi da ogni testo scritto o stampato.
const secrets = { apiToken: process.env.GREEN_API_TOKEN?.trim() ?? '', idInstance: process.env.GREEN_API_INSTANCE_ID?.trim() ?? '' };
const redact = (text: string) => redactSecrets(text, secrets);
const log = (line: string) => console.log(redact(line));

async function existingImageHashes(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const f of await readdir(path.join(outRoot, 'images'))) {
      const m = /^([a-f0-9]{64})\.(jpg|png|webp)$/.exec(f);
      if (m?.[1]) map.set(m[1], `images/${f}`);
    }
  } catch { /* cartella assente: prima esecuzione */ }
  return map;
}

/**
 * Rilegge l'ultima risposta REALE salvata (stesso venditore). Non è una fonte
 * di dati d'esempio: rifiuta un raw assente, di un altro provider o di un altro chatId.
 */
async function resultFromRaw(source: ExternalCatalogSource): Promise<ExternalCatalogResult> {
  const raw = await readJsonArtifact<{
    provider?: string; source?: ExternalCatalogSource; fetched_at?: string; pages?: ExternalCatalogPage[];
    completeness?: ReadCompleteness; stats?: ExternalCatalogReadStats;
  }>(outRoot, ARTIFACT_FILES.raw);
  if (!raw || raw.provider !== 'green_api' || !Array.isArray(raw.pages) || !raw.fetched_at) {
    throw new ExternalCatalogError('UNEXPECTED_RESPONSE', `Nessuna lettura reale riutilizzabile in ${ARTIFACT_FILES.raw}: eseguire prima senza --from-raw.`);
  }
  if (raw.source?.chatId !== source.chatId) {
    throw new ExternalCatalogError('SOURCE_INVALID', `${ARTIFACT_FILES.raw} appartiene a un altro venditore (${raw.source?.chatId ?? '?'}).`);
  }
  const collected = collectGreenApiProducts(raw.pages, limit);
  // Completezza: quella registrata alla lettura; i raw precedenti (solo getProducts,
  // con altre pagine segnalate) erano letture troncate.
  const firstAfter = (raw.pages[0]?.body as { paging?: { after?: string } } | undefined)?.paging?.after ?? '';
  const completeness: ReadCompleteness = raw.completeness ?? (firstAfter ? 'truncated' : 'complete');
  return {
    provider: 'green_api', source, fetchedAt: raw.fetched_at, products: collected.products, pages: raw.pages,
    truncated: completeness !== 'complete', completeness,
    stats: {
      ...collected.stats,
      getProductsHasMore: Boolean(firstAfter),
      collectionsPagesListed: raw.pages.filter((p) => p.method === 'getCollections').length,
      requests: raw.stats?.requests ?? raw.pages.length,
      stopReason: raw.stats?.stopReason ?? null,
    },
    diagnostics: [{ code: 'FROM_RAW', message: `Rielaborazione della lettura reale del ${raw.fetched_at}.` }, ...collected.diagnostics],
  };
}

async function writeReport(report: RunReport, products: NormalizedExternalProduct[]): Promise<void> {
  if (dryRun) return;
  await writeJsonArtifact(outRoot, ARTIFACT_FILES.reportJson, report, redact);
  const decisions = await loadDecisions(outRoot, products, report.generated_at);
  await writeArtifact(outRoot, ARTIFACT_FILES.reportHtml, renderReportHtml(report, products, decisions), redact);
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const options = { limit, dry_run: dryRun, images: withImages };
  const providerId = process.env.WHATSAPP_CATALOG_PROVIDER?.trim() || 'green_api';
  const diagnostics: ExternalCatalogDiagnostic[] = [];
  let source: ReturnType<typeof parseWhatsAppCatalogUrl> | null = null;

  log(`[catalog] artefatti: ${path.relative(REPO_ROOT, outRoot)}${dryRun ? ' (dry-run: nessuna scrittura)' : ''}`);

  let result: ExternalCatalogResult;
  try {
    source = parseWhatsAppCatalogUrl(values.url as string, values['chat-id'] ?? null);
    if (values['chat-id']) {
      diagnostics.push({ code: 'SOURCE_CHAT_ID_OVERRIDE', message: `chatId del venditore fornito manualmente: ${source.chatId} (link: ${source.url}).` });
    } else if (!isValidPhoneNumber(`+${source.catalogId}`)) {
      diagnostics.push({
        code: 'SOURCE_NOT_E164',
        message: `L'identificativo ${source.catalogId} del link non è un numero di telefono (i link wa.me/c/ possono contenere l'ID del catalogo): getProducts lo rifiuterà. Indicare il numero del venditore con --chat-id <numero>@c.us.`,
      });
      log(`[catalog] attenzione: ${diagnostics[diagnostics.length - 1]?.message}`);
    }
    if (values['from-raw']) {
      result = await resultFromRaw(source);
      log(`[catalog] rielaborazione di ${ARTIFACT_FILES.raw} (lettura reale del ${result.fetchedAt}), nessuna chiamata al provider`);
    } else {
      const provider = getExternalCatalogProvider(process.env, { log });
      log(`[catalog] provider ${provider.id}, chatId ${source.chatId}, limite ${limit}`);
      result = await provider.fetchProducts(source, {
        limit, timeoutMs, collections: !values['no-collections'], pageDelayMs: Math.max(500, Number(values['page-delay-ms']) || 1000),
      });
    }
  } catch (err) {
    const e = err instanceof ExternalCatalogError
      ? err
      : new ExternalCatalogError('PROVIDER_ERROR', `Errore inatteso: ${String((err as Error)?.message ?? err)}`);
    const report = buildRunReport({
      generatedAt: startedAt, status: 'failed', provider: providerId,
      sourceUrl: source?.url ?? null, chatId: source?.chatId ?? null,
      error: { code: e.code, message: redact(e.message), hint: e.hint, http_status: e.httpStatus },
      options, products: [], truncated: false, diagnostics,
    });
    await writeReport(report, []);
    console.error(redact(`\n✖ Accesso al catalogo NON riuscito — ${e.code}: ${e.message}`));
    if (e.hint) console.error(redact(`  ${e.hint}`));
    console.error('  Flusso interrotto: nessun dato simulato è stato prodotto.');
    if (!dryRun) console.error(`  Diagnosi: ${path.relative(REPO_ROOT, path.join(outRoot, ARTIFACT_FILES.reportHtml))}`);
    return 2;
  }

  diagnostics.push(...result.diagnostics);
  const products = result.products.map((raw) => normalizeExternalProduct(raw, {
    provider: result.provider, catalogId: result.source.catalogId, rawFile: ARTIFACT_FILES.raw,
  }));

  if (!dryRun && !values['from-raw']) {
    await writeJsonArtifact(outRoot, ARTIFACT_FILES.raw, {
      provider: result.provider,
      source: result.source,
      fetched_at: result.fetchedAt,
      truncated: result.truncated,
      completeness: result.completeness,
      stats: result.stats,
      diagnostics: result.diagnostics,
      pages: result.pages,
    }, redact);
  }

  if (withImages) {
    const allowed = process.env.WHATSAPP_CATALOG_IMAGE_HOSTS?.split(',').map((s) => s.trim()).filter(Boolean) ?? DEFAULT_IMAGE_HOST_SUFFIXES;
    const stager = createImageStager(
      { writeFile: (rel, bytes) => writeArtifact(outRoot, rel, bytes) },
      { allowedHostSuffixes: allowed, dryRun, timeoutMs },
      await existingImageHashes(),
    );
    for (const p of products) {
      for (const img of p.images) {
        let staged = await stager.stage(img.url);
        // Originale non disponibile → anteprima come ripiego, segnalato come tale.
        if (!['downloaded', 'duplicate'].includes(staged.status) && img.variant === 'original' && img.preview_url && img.preview_url !== img.url) {
          const fallback = await stager.stage(img.preview_url);
          if (['downloaded', 'duplicate'].includes(fallback.status)) {
            staged = { ...fallback, detail: `Originale non disponibile (${staged.detail ?? staged.status}): usata l'anteprima.` };
            img.variant = 'preview';
            img.url = img.preview_url;
          }
        }
        img.staging = staged;
      }
    }
    if (!dryRun) {
      await writeJsonArtifact(outRoot, ARTIFACT_FILES.imagesManifest, products.flatMap((p) => p.images.map((i) => ({
        source_product_id: p.source_product_id, provider_image_id: i.provider_image_id, variant: i.variant,
        original_url: i.original_url, preview_url: i.preview_url, ...i.staging,
      }))), redact);
    }
  } else {
    for (const p of products) for (const img of p.images) {
      img.staging = { status: 'skipped', sha256: null, file: null, mime: null, bytes: null, width: null, height: null, detail: '--no-images', fetched_at: startedAt };
    }
  }

  if (!dryRun) await writeJsonArtifact(outRoot, ARTIFACT_FILES.normalized, products, redact);

  const report = buildRunReport({
    generatedAt: startedAt, status: products.length > 0 ? 'success' : 'empty', provider: result.provider,
    sourceUrl: result.source.url, chatId: result.source.chatId, options, products, truncated: result.truncated,
    completeness: result.completeness ?? null, readStats: result.stats ?? null, diagnostics,
  });
  await writeReport(report, products);

  const c = report.counts;
  log(`\n✔ Accesso al catalogo riuscito (${result.provider}).`);
  const r = report.read;
  log(`  Prodotti unici: ${c.products_retrieved} · lettura ${r.completeness ?? 'n/d'}`);
  if (r.unique_products !== null) {
    log(`  getProducts: ${r.get_products_products} · collezioni: ${r.collections_found} (${r.collection_pages} pagine, ${r.products_from_collections} prodotti) · duplicati eliminati: ${r.duplicates_removed} · fuori collezione fra i primi 10: ${r.outside_collections} · richieste: ${r.requests}`);
  }
  if (r.stop_reason) log(`  Interruzione: ${r.stop_reason}`);
  log(`  Immagini: ${c.images_declared} dichiarate, ${c.images_available} disponibili in staging (${c.images_downloaded} nuove, ${c.images_duplicate} già presenti/duplicate), ${c.images_unavailable} non disponibili`);
  log(`  Quantità minima proposta: ${c.min_quantity_proposed} · step proposti: ${c.step_proposed} · da revisionare: ${c.requires_review}`);
  if (!dryRun) log(`  Report: ${path.relative(REPO_ROOT, path.join(outRoot, ARTIFACT_FILES.reportHtml))} — revisione: pnpm catalog:whatsapp:review`);
  return products.length > 0 ? 0 : 3;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error(redact(`Errore interno: ${String((err as Error)?.stack ?? err)}`));
  process.exit(1);
});
