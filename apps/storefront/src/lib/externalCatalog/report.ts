import { previewValidQuantities, toLepefyQuantityRule } from './normalizeProduct';
import type {
  ExternalCatalogDiagnostic,
  ExternalCatalogProviderId,
  ExternalCatalogReadStats,
  ExternalProductReviewDecision,
  NormalizedExternalProduct,
  ReadCompleteness,
  UnitFormat,
} from './types';

/**
 * Report del ciclo sperimentale (JSON + HTML di revisione). Il report dice
 * sempre da dove vengono i dati: `data_origin = 'live_provider'` — la CLI non
 * ha alcuna modalità che produca un report da dati d'esempio.
 */

export const PRODUCTION_LIMITATIONS = [
  'GREEN-API non è un\'API ufficiale Meta: si appoggia a una sessione WhatsApp (Web) di un account controllato da Lepefy. Le condizioni d\'uso di WhatsApp vietano accessi automatizzati non autorizzati: rischio di blocco del numero e nessuna garanzia contrattuale.',
  'WhatsApp può limitare temporaneamente l\'API cataloghi in caso di chiamate frequenti (doc GREEN-API): nessuna sincronizzazione ad alta frequenza.',
  'Il parametro di richiesta per il cursore di paginazione (paging.after) non è documentato: i cataloghi più grandi di una pagina non sono recuperabili integralmente.',
  'Scala del prezzo: millesimi (÷1000), ricavata dal primo catalogo reale perché la documentazione GREEN-API indica ÷100; da riconfermare se il provider cambia formato.',
  'Diritti d\'uso: testi e fotografie appartengono al venditore. Serve un consenso scritto prima di pubblicarli nello storefront di un tenant o di copiarli nello storage Lepefy.',
  'Gli URL immagine delle CDN Meta sono firmati e scadono: lo staging va fatto subito dopo la lettura.',
  'Nessuna tabella di provenienza/deduplica/audit in questo ciclo: le decisioni restano negli artefatti locali.',
];

export const UNRECOVERABLE_DATA = [
  'Modello di prezzo (prezzo per lotto o per unità): non dimostrabile dal catalogo, sempre da confermare.',
  'Stock reale del venditore: solo `availability`; `max_available` restituisce 99 per tutti i prodotti (limite fisso, non stock).',
  'Peso di spedizione, ingredienti, allergeni, origine: non presenti nella struttura prodotto del catalogo.',
  'Categorie Lepefy: le collezioni del venditore sono lette e conservate su ogni prodotto, ma non sono mappate automaticamente alle categorie del tenant.',
];

export type RunStatus = 'success' | 'empty' | 'failed';

export interface RunReport {
  generated_at: string;
  data_origin: 'live_provider';
  status: RunStatus;
  access: {
    succeeded: boolean;
    provider: ExternalCatalogProviderId | string;
    source_url: string | null;
    chat_id: string | null;
  };
  error: { code: string; message: string; hint: string | null; http_status: number | null } | null;
  options: { limit: number; dry_run: boolean; images: boolean };
  counts: {
    products_retrieved: number;
    products_with_images: number;
    images_declared: number;
    /** File locali utilizzabili (scaricati ora o già presenti in staging). */
    images_available: number;
    images_downloaded: number;
    images_duplicate: number;
    images_unavailable: number;
    min_quantity_proposed: number;
    step_proposed: number;
    requires_review: number;
    price_missing_or_invalid: number;
    description_missing: number;
  };
  truncated: boolean;
  /** Lettura: completezza verificabile e provenienza (getProducts / collezioni). */
  read: {
    completeness: ReadCompleteness | null;
    get_products_products: number | null;
    collections_found: number | null;
    collection_pages: number | null;
    products_from_collections: number | null;
    duplicates_removed: number | null;
    unique_products: number | null;
    outside_collections: number | null;
    requests: number | null;
    stop_reason: string | null;
  };
  diagnostics: ExternalCatalogDiagnostic[];
  unrecoverable_data: string[];
  production_limitations: string[];
  products: Array<{
    source_product_id: string;
    name: string | null;
    displayed_price: number | null;
    sale_price: number | null;
    currency: string | null;
    suggested_min_quantity: number | null;
    suggested_quantity_step: number | null;
    requires_review: boolean;
    reasons: string[];
    images: number;
  }>;
}

export function buildRunReport(input: {
  generatedAt: string;
  status: RunStatus;
  provider: string;
  sourceUrl: string | null;
  chatId: string | null;
  error?: RunReport['error'];
  options: RunReport['options'];
  products: NormalizedExternalProduct[];
  truncated: boolean;
  completeness?: ReadCompleteness | null;
  readStats?: ExternalCatalogReadStats | null;
  diagnostics: ExternalCatalogDiagnostic[];
}): RunReport {
  const ps = input.products;
  const allImages = ps.flatMap((p) => p.images);
  const dynamicUnrecoverable: string[] = [];
  const noCurrency = ps.filter((p) => p.review_reasons.some((r) => r.code === 'CURRENCY_MISSING')).length;
  if (noCurrency > 0) dynamicUnrecoverable.push(`Valuta assente per ${noCurrency} prodotto/i.`);
  if (input.completeness === 'partial') {
    dynamicUnrecoverable.push('Eventuali prodotti fuori dalle collezioni oltre i primi 10 di getProducts (GREEN-API non pagina getProducts).');
  } else if (input.truncated) {
    dynamicUnrecoverable.push(`Prodotti non letti: lettura interrotta${input.readStats?.stopReason ? ` (${input.readStats.stopReason})` : ''}.`);
  }

  return {
    generated_at: input.generatedAt,
    data_origin: 'live_provider',
    status: input.status,
    access: {
      succeeded: input.status !== 'failed',
      provider: input.provider,
      source_url: input.sourceUrl,
      chat_id: input.chatId,
    },
    error: input.error ?? null,
    options: input.options,
    counts: {
      products_retrieved: ps.length,
      products_with_images: ps.filter((p) => p.images.length > 0).length,
      images_declared: allImages.length,
      images_available: allImages.filter((i) => Boolean(i.staging?.file)).length,
      images_downloaded: allImages.filter((i) => i.staging?.status === 'downloaded').length,
      images_duplicate: allImages.filter((i) => i.staging?.status === 'duplicate').length,
      images_unavailable: allImages.filter((i) => i.staging && !['downloaded', 'duplicate', 'skipped'].includes(i.staging.status)).length,
      min_quantity_proposed: ps.filter((p) => p.suggested_min_quantity !== null && p.suggested_min_quantity > 1).length,
      step_proposed: ps.filter((p) => p.suggested_quantity_step !== null).length,
      requires_review: ps.filter((p) => p.requires_review).length,
      price_missing_or_invalid: ps.filter((p) => p.displayed_price === null).length,
      description_missing: ps.filter((p) => p.original_description === null).length,
    },
    truncated: input.truncated,
    read: {
      completeness: input.completeness ?? null,
      get_products_products: input.readStats?.getProductsProducts ?? null,
      collections_found: input.readStats?.collectionsFound ?? null,
      collection_pages: input.readStats?.collectionPages ?? null,
      products_from_collections: input.readStats?.productsFromCollections ?? null,
      duplicates_removed: input.readStats?.duplicatesRemoved ?? null,
      unique_products: input.readStats?.uniqueProducts ?? null,
      outside_collections: input.readStats?.outsideCollections ?? null,
      requests: input.readStats?.requests ?? null,
      stop_reason: input.readStats?.stopReason ?? null,
    },
    diagnostics: input.diagnostics,
    unrecoverable_data: [...UNRECOVERABLE_DATA, ...dynamicUnrecoverable],
    production_limitations: PRODUCTION_LIMITATIONS,
    products: ps.map((p) => ({
      source_product_id: p.source_product_id,
      name: p.normalized_name,
      displayed_price: p.displayed_price,
      sale_price: p.sale_price,
      currency: p.currency,
      suggested_min_quantity: p.suggested_min_quantity,
      suggested_quantity_step: p.suggested_quantity_step,
      requires_review: p.requires_review,
      reasons: p.review_reasons.map((r) => r.code),
      images: p.images.length,
    })),
  };
}

// ─── HTML ────────────────────────────────────────────────────────────────────

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON sicuro dentro <script type="application/json">. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

const UNIT_LABEL: Record<UnitFormat['unit'], string> = { g: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'L', unit: 'unità' };

function formatUnit(f: UnitFormat | null): string {
  if (!f) return '—';
  return f.value === null ? UNIT_LABEL[f.unit] : `${String(f.value).replace('.', ',')} ${UNIT_LABEL[f.unit]}`;
}

function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return 'Non disponibile';
  return `${value.toFixed(2).replace('.', ',')} ${currency ?? '(valuta ?)'}`;
}

const COMPLETENESS_LABEL: Record<ReadCompleteness, string> = { complete: 'completa', partial: 'parziale', truncated: 'troncata' };

const CONFIDENCE_LABEL = { high: 'Alta', medium: 'Media', low: 'Bassa', none: 'Nessuna' } as const;
const MODEL_LABEL = { requires_review: 'Da verificare', single_item: 'Articolo singolo', unknown: 'Sconosciuto' } as const;

function productCard(p: NormalizedExternalProduct, d: ExternalProductReviewDecision): string {
  const staged = p.images.filter((i) => i.staging?.file);
  const photo = staged[0]?.staging?.file
    ? `<img src="${escapeHtml(staged[0].staging.file)}" alt="${escapeHtml(p.normalized_name ?? 'Prodotto')}" loading="lazy">`
    : `<div class="nophoto">${p.images.length > 0 ? 'Immagine non scaricata' : 'Nessuna immagine'}</div>`;
  const moreImages = staged.length > 1 ? `<div class="muted small">+${staged.length - 1} immagini</div>` : '';
  const imageNotes = p.images
    .filter((i) => i.staging && i.staging.status !== 'downloaded')
    .map((i) => `<li>${escapeHtml(i.staging?.status)} — ${escapeHtml(i.staging?.detail ?? '')}</li>`)
    .join('');
  const rule = toLepefyQuantityRule(d);
  const validQuantities = previewValidQuantities(rule.min_order_quantity, rule.order_quantity_step).join(', ');
  const reasons = p.review_reasons.map((r) => `<li><code>${escapeHtml(r.code)}</code> ${escapeHtml(r.message)}</li>`).join('');
  const matches = p.inference.matches.length
    ? p.inference.matches.map((m) => `<mark>${escapeHtml(m)}</mark>`).join(' ')
    : '<span class="muted">nessun frammento riconosciuto</span>';
  const id = escapeHtml(p.source_product_id);
  const statusClass = d.status === 'confirmed' ? 'ok' : d.status === 'rejected' ? 'ko' : p.requires_review ? 'warn' : 'neutral';
  const statusLabel = d.status === 'confirmed' ? 'Confermato' : d.status === 'rejected' ? 'Scartato' : p.requires_review ? 'Da revisionare' : 'In attesa';

  return `
<article class="card" data-id="${id}">
  <div class="photo">${photo}${moreImages}</div>
  <div class="body">
    <header>
      <h2>${escapeHtml(p.original_name ?? '(senza nome)')}</h2>
      <span class="badge ${statusClass}">${statusLabel}</span>
    </header>
    <p class="desc">${p.original_description ? escapeHtml(p.original_description) : '<span class="muted">Nessuna descrizione</span>'}</p>
    <dl class="facts">
      <div><dt>Prezzo mostrato</dt><dd>${escapeHtml(formatPrice(p.displayed_price, p.currency))}${p.sale_price !== null ? ` <small>(promo ${escapeHtml(formatPrice(p.sale_price, p.currency))})</small>` : ''}</dd></div>
      <div><dt>Q.tà minima suggerita</dt><dd>${p.suggested_min_quantity ?? '—'}${p.suggested_min_quantity !== null && !p.inference.min_is_explicit ? ' <small>(inferita)</small>' : ''}</dd></div>
      <div><dt>Step suggerito</dt><dd>${p.suggested_quantity_step ?? '—'}</dd></div>
      <div><dt>Formato unità</dt><dd>${escapeHtml(formatUnit(p.unit_format))}</dd></div>
      <div><dt>Unità nel prodotto</dt><dd>${p.package_count ?? '—'}</dd></div>
      <div><dt>Totale</dt><dd>${p.package_total_weight ? `${p.package_total_weight.value} ${p.package_total_weight.unit}` : '—'}</dd></div>
      <div><dt>Modello di vendita</dt><dd>${MODEL_LABEL[p.selling_model]}</dd></div>
      <div><dt>Affidabilità</dt><dd>${CONFIDENCE_LABEL[p.extraction_confidence]}</dd></div>
    </dl>
    <details ${p.requires_review ? 'open' : ''}>
      <summary>Motivo dell'inferenza</summary>
      <p class="small">Fonte: ${escapeHtml(p.inference.source_field ?? '—')} · estrattore ${escapeHtml(p.inference.extractor)} · ${matches}</p>
      <ul class="reasons">${reasons}</ul>
      ${imageNotes ? `<ul class="reasons small">${imageNotes}</ul>` : ''}
    </details>
    <form class="review" data-id="${id}">
      <fieldset>
        <legend>Revisione (salvata solo negli artefatti locali)</legend>
        <label>Quantità minima <input type="number" name="min_quantity" min="1" step="1" value="${d.min_quantity ?? ''}"></label>
        <label class="check"><input type="checkbox" name="min_quantity_confirmed" ${d.min_quantity_confirmed ? 'checked' : ''}> confermata</label>
        <label>Step <input type="number" name="quantity_step" min="1" step="1" value="${d.quantity_step ?? ''}"></label>
        <label class="check"><input type="checkbox" name="quantity_step_confirmed" ${d.quantity_step_confirmed ? 'checked' : ''}> confermato</label>
        <label>Modello di prezzo
          <select name="price_model">
            <option value="unknown" ${d.price_model === 'unknown' ? 'selected' : ''}>Da stabilire</option>
            <option value="per_lot" ${d.price_model === 'per_lot' ? 'selected' : ''}>Prezzo del lotto intero</option>
            <option value="per_unit" ${d.price_model === 'per_unit' ? 'selected' : ''}>Prezzo per unità (con minimo)</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" name="price_model_confirmed" ${d.price_model_confirmed ? 'checked' : ''}> confermato</label>
        <label>Stato
          <select name="status">
            <option value="pending" ${d.status === 'pending' ? 'selected' : ''}>In attesa</option>
            <option value="confirmed" ${d.status === 'confirmed' ? 'selected' : ''}>Confermato</option>
            <option value="rejected" ${d.status === 'rejected' ? 'selected' : ''}>Scartato</option>
          </select>
        </label>
        <label class="wide">Nota <input type="text" name="note" maxlength="1000" value="${escapeHtml(d.note ?? '')}"></label>
      </fieldset>
      <p class="small muted">Regola Lepefy risultante (solo valori confermati): minimo ${rule.min_order_quantity}, step ${rule.order_quantity_step} → quantità valide ${validQuantities}…</p>
    </form>
  </div>
</article>`;
}

export function renderReportHtml(report: RunReport, products: NormalizedExternalProduct[], decisions: ExternalProductReviewDecision[]): string {
  const byId = new Map(decisions.map((d) => [d.source_product_id, d]));
  const c = report.counts;
  const banner = report.status === 'failed'
    ? `<section class="banner ko"><strong>Accesso al catalogo non riuscito</strong> — <code>${escapeHtml(report.error?.code)}</code> ${escapeHtml(report.error?.message)}${report.error?.hint ? `<br><span class="small">${escapeHtml(report.error.hint)}</span>` : ''}</section>`
    : report.status === 'empty'
      ? '<section class="banner warn"><strong>Accesso riuscito, nessun prodotto restituito.</strong></section>'
      : '<section class="banner ok"><strong>Accesso al catalogo reale riuscito.</strong> Dati letti dal provider, nessun dato d\'esempio.</section>';
  const cards = products.map((p) => productCard(p, byId.get(p.source_product_id) ?? {
    source_product_id: p.source_product_id, status: 'pending', min_quantity: p.suggested_min_quantity, min_quantity_confirmed: false,
    quantity_step: p.suggested_quantity_step, quantity_step_confirmed: false, price_model: 'unknown', price_model_confirmed: false, note: null, updated_at: '',
  })).join('\n');
  const list = (items: string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join('');
  const diag = report.diagnostics.map((d) => `<li><code>${escapeHtml(d.code)}</code> ${escapeHtml(d.message)}</li>`).join('');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'">
<title>Revisione catalogo WhatsApp</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --ink:#1d2330; --muted:#667085; --line:#e4e7ec; --ok:#067647; --okbg:#ecfdf3; --warn:#b54708; --warnbg:#fffaeb; --ko:#b42318; --kobg:#fef3f2; --accent:#1f6feb; }
@media (prefers-color-scheme: dark) { :root { --bg:#0f1115; --card:#171a21; --ink:#e6e8ec; --muted:#98a2b3; --line:#2a2f3a; --okbg:#0b2a1c; --warnbg:#2e2208; --kobg:#2d1110; --ok:#47cd89; --warn:#fdb022; --ko:#f97066; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width:1100px; margin:0 auto; padding:16px; }
h1 { font-size:20px; margin:8px 0 4px; }
.muted { color:var(--muted); } .small { font-size:12px; }
.banner { padding:12px 14px; border-radius:8px; margin:12px 0; border:1px solid var(--line); }
.banner.ok { background:var(--okbg); } .banner.warn { background:var(--warnbg); } .banner.ko { background:var(--kobg); }
.stats { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:8px; margin:12px 0; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:10px; }
.stat b { display:block; font-size:20px; }
.card { display:grid; grid-template-columns:200px 1fr; gap:16px; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px; margin:12px 0; }
.photo img { width:100%; aspect-ratio:1; object-fit:contain; background:#fff; border-radius:8px; border:1px solid var(--line); }
.nophoto { aspect-ratio:1; display:grid; place-items:center; border:1px dashed var(--line); border-radius:8px; color:var(--muted); text-align:center; padding:8px; }
.card header { display:flex; justify-content:space-between; gap:8px; align-items:start; }
.card h2 { font-size:16px; margin:0; }
.badge { font-size:12px; padding:2px 8px; border-radius:999px; white-space:nowrap; border:1px solid var(--line); }
.badge.ok { color:var(--ok); background:var(--okbg); } .badge.warn { color:var(--warn); background:var(--warnbg); } .badge.ko { color:var(--ko); background:var(--kobg); }
.desc { white-space:pre-wrap; margin:6px 0 10px; }
.facts { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:6px 12px; margin:0 0 8px; }
.facts dt { color:var(--muted); font-size:12px; } .facts dd { margin:0; font-weight:600; }
.reasons { margin:6px 0; padding-left:18px; } .reasons li { margin:2px 0; }
mark { background:var(--warnbg); color:inherit; padding:0 3px; border-radius:3px; }
fieldset { border:1px solid var(--line); border-radius:8px; display:flex; flex-wrap:wrap; gap:8px 14px; align-items:end; }
legend { font-size:12px; color:var(--muted); }
label { display:flex; flex-direction:column; font-size:12px; gap:2px; }
label.check { flex-direction:row; align-items:center; gap:4px; }
label.wide { flex:1 1 220px; }
input, select { font:inherit; padding:5px 7px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); min-height:32px; }
input[type=number] { width:90px; }
.toolbar { position:sticky; top:0; z-index:2; background:var(--bg); padding:8px 0; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border-bottom:1px solid var(--line); }
button { font:inherit; padding:7px 14px; border-radius:6px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; min-height:36px; }
code { font-size:12px; }
@media (max-width:640px) { .card { grid-template-columns:1fr; } .photo { max-width:220px; } }
</style>
</head>
<body>
<main>
<h1>Revisione catalogo WhatsApp esterno</h1>
<p class="muted small">Generato ${escapeHtml(report.generated_at)} · provider ${escapeHtml(report.access.provider)} · sorgente ${escapeHtml(report.access.source_url ?? '—')} · ${report.status === 'failed' ? 'nessun dato ricevuto dal provider' : 'origine dati: provider reale'}</p>
${banner}
<section class="stats">
  <div class="stat"><b>${c.products_retrieved}</b>prodotti recuperati${report.read.completeness ? ` · lettura ${COMPLETENESS_LABEL[report.read.completeness]}` : ''}</div>
  <div class="stat"><b>${c.images_available}</b>immagini disponibili (${c.images_declared} dichiarate)</div>
  <div class="stat"><b>${c.min_quantity_proposed}</b>minimi proposti</div>
  <div class="stat"><b>${c.step_proposed}</b>step proposti</div>
  <div class="stat"><b>${c.requires_review}</b>da revisionare</div>
  <div class="stat"><b>${c.price_missing_or_invalid}</b>senza prezzo valido</div>
</section>
${products.length ? `<div class="toolbar"><button type="button" id="save">Salva revisione</button><span id="saveStatus" class="small muted"></span></div>` : ''}
${cards}
<details open><summary>Lettura del catalogo</summary>${report.read.unique_products === null ? '<p class="small muted">Statistiche non disponibili (lettura precedente).</p>' : `<ul class="reasons">
  <li>getProducts: ${report.read.get_products_products} prodotti (prima pagina, unica leggibile)</li>
  <li>Collezioni: ${report.read.collections_found}, pagine getCollection: ${report.read.collection_pages}, prodotti letti dalle collezioni: ${report.read.products_from_collections}</li>
  <li>Duplicati eliminati: ${report.read.duplicates_removed} · prodotti unici: ${report.read.unique_products} · fuori da ogni collezione (fra i primi 10): ${report.read.outside_collections}</li>
  <li>Richieste: ${report.read.requests}${report.read.stop_reason ? ` · interruzione: ${escapeHtml(report.read.stop_reason)}` : ''}</li></ul>`}</details>
<details><summary>Diagnostica del provider</summary><ul class="reasons">${diag || '<li>Nessuna</li>'}</ul></details>
<details><summary>Dati non recuperabili</summary><ul class="reasons">${list(report.unrecoverable_data)}</ul></details>
<details><summary>Limitazioni per l'uso in produzione</summary><ul class="reasons">${list(report.production_limitations)}</ul></details>
</main>
<script type="application/json" id="decisions">${jsonForScript(decisions)}</script>
<script>
(function () {
  var btn = document.getElementById('save');
  if (!btn) return;
  var status = document.getElementById('saveStatus');
  var base = JSON.parse(document.getElementById('decisions').textContent || '[]');
  var byId = {};
  base.forEach(function (d) { byId[d.source_product_id] = d; });
  function intOrNull(v) { var n = parseInt(v, 10); return Number.isFinite(n) && n >= 1 ? n : null; }
  function collect() {
    var now = new Date().toISOString();
    return Array.prototype.map.call(document.querySelectorAll('form.review'), function (f) {
      var id = f.getAttribute('data-id');
      return {
        source_product_id: id,
        status: f.status.value,
        min_quantity: intOrNull(f.min_quantity.value),
        min_quantity_confirmed: f.min_quantity_confirmed.checked,
        quantity_step: intOrNull(f.quantity_step.value),
        quantity_step_confirmed: f.quantity_step_confirmed.checked,
        price_model: f.price_model.value,
        price_model_confirmed: f.price_model_confirmed.checked,
        note: f.note.value.trim() || null,
        updated_at: now
      };
    });
  }
  btn.addEventListener('click', function () {
    var payload = { version: 1, decisions: collect() };
    if (location.protocol === 'http:' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
      status.textContent = 'Salvataggio…';
      fetch('/api/decisions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          status.textContent = res.ok ? 'Salvato in review/decisions.json. Ricarico…' : ('Errore: ' + (res.j && res.j.error || 'sconosciuto'));
          if (res.ok) setTimeout(function () { location.reload(); }, 600);
        })
        .catch(function () { status.textContent = 'Server di revisione non raggiungibile.'; });
    } else {
      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'decisions.json';
      a.click();
      status.textContent = 'File scaricato: copiarlo in artifacts/whatsapp-catalog/review/decisions.json (oppure usare pnpm catalog:whatsapp:review).';
    }
  });
})();
</script>
</body>
</html>`;
}
