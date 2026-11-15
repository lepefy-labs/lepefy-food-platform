#!/usr/bin/env node
// Lepefy Growth — CLI indipendente dallo storefront e dall'admin.
// L'agente di ricerca produce i file di un'esecuzione; questa CLI li controlla,
// deduplica, qualifica, archivia ed esporta. Non invia nulla a nessuno.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate } from './src/qualify.mjs';
import { loadStore, saveStore, upsertProspect, recordOutcome, loadOutcomes, summarizeOutcomes, OUTCOME_TYPES } from './src/store.mjs';
import { toMarkdown, toCsv, funnel, rank } from './src/exporter.mjs';
import { compareIdentity, identityKeys } from './src/identity.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = process.env.GROWTH_DATA_DIR ? resolve(process.env.GROWTH_DATA_DIR) : join(ROOT, 'data');
const STORE = join(DATA, 'store.json');
const OUTCOMES = join(DATA, 'outcomes.jsonl');
// Identità che hanno chiesto di non essere ricontattate (scaricate dalla piattaforma con «push»).
const SUPPRESSIONS = join(DATA, 'suppressions.json');
const suppressionKeys = () => new Set(existsSync(SUPPRESSIONS) ? readJson(SUPPRESSIONS).keys ?? [] : []);
const suppressedKey = (d, keys) => identityKeys(d).strong.find((k) => keys.has(k)) ?? null;
const today = () => process.env.GROWTH_TODAY ?? new Date().toISOString().slice(0, 10);
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); };
const features = () => readJson(join(ROOT, 'config', 'features.json')).features;

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const next = argv[i + 1]; if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true; else { out[a.slice(2)] = next; i++; } } else out._.push(a);
  }
  return out;
}
const runDir = (id) => join(DATA, 'runs', id);
function loadRun(id) {
  const p = join(runDir(id), 'run.json');
  if (!id || !existsSync(p)) throw new Error(`Esecuzione sconosciuta: ${id}. Crea prima con: run:new`);
  return readJson(p);
}

const commands = {
  /** Crea un'esecuzione con area, segmento e budget di ricerca configurabili. */
  'run:new'(a) {
    const defaults = readJson(join(ROOT, 'config', 'default.json'));
    const config = {
      area: a.area ?? defaults.area, segment: a.segment ?? defaults.segment, languages: (a.languages ?? defaults.languages.join(',')).split(','),
      budget: { searches: Number(a['max-searches'] ?? defaults.budget.searches), pages: Number(a['max-pages'] ?? defaults.budget.pages) },
      targetQualified: Number(a.target ?? defaults.targetQualified),
    };
    const id = a.id ?? `${today()}-${config.segment}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
    if (existsSync(join(runDir(id), 'run.json'))) throw new Error(`Esecuzione già esistente: ${id}`);
    writeJson(join(runDir(id), 'run.json'), { id, createdAt: today(), config });
    console.log(`Esecuzione creata: ${id}`);
    commands.brief({ run: id });
  },

  /** Consegna all'agente: configurazione, budget e aziende già note da non riproporre. */
  brief(a) {
    const run = loadRun(a.run);
    const store = loadStore(STORE);
    console.log(JSON.stringify({
      run: run.id, ...run.config,
      istruzioni: 'growth/AGENT.md',
      scrivere: [`${join(runDir(run.id), 'discovery.json')}`, `${join(runDir(run.id), 'dossiers.json')}`],
      nonRicontattare: [...suppressionKeys()],
      giaNote: store.prospects.map((p) => ({ id: p.id, nome: p.dossier.name, citta: p.dossier.city, stato: p.evaluation.status, ultimoControllo: p.lastSeen })),
    }, null, 2));
  },

  /** Controlla, deduplica, qualifica e archivia le schede dell'esecuzione. */
  ingest(a) {
    const run = loadRun(a.run);
    const dir = runDir(run.id);
    const dossiers = readJson(a.file ?? join(dir, 'dossiers.json'));
    const discoveryPath = join(dir, 'discovery.json');
    const discovery = existsSync(discoveryPath) ? readJson(discoveryPath) : null;
    const problems = [];
    if (!discovery) problems.push('discovery.json assente: manca il registro di ricerche e candidate.');
    else {
      const searches = discovery.searchLog?.length ?? 0; const pages = discovery.pagesOpened ?? 0;
      if (searches > run.config.budget.searches) problems.push(`Budget ricerche superato: ${searches}/${run.config.budget.searches}.`);
      if (pages > run.config.budget.pages) problems.push(`Budget pagine superato: ${pages}/${run.config.budget.pages}.`);
      if (searches === 0) problems.push('Nessuna ricerca registrata: la scoperta non è documentata.');
    }
    // stessa azienda due volte nello stesso lotto
    for (let i = 0; i < dossiers.length; i++) for (let j = i + 1; j < dossiers.length; j++) {
      if (compareIdentity(dossiers[i], dossiers[j]) === 'same') problems.push(`Doppione nel lotto: «${dossiers[i].name}» e «${dossiers[j].name}» sono la stessa azienda.`);
    }
    if (problems.length && !a.force) { console.error(problems.map((p) => `ERRORE ${p}`).join('\n')); process.exitCode = 1; return; }

    const store = loadStore(STORE);
    const ctx = { features: features(), today: today(), targetSegment: run.config.segment };
    const report = [];
    const suppressed = suppressionKeys();
    for (const d of dossiers) {
      const key = suppressedKey(d, suppressed);
      if (key) { report.push({ name: d.name, action: 'esclusa', errors: [`Ha chiesto di non essere ricontattata (${key}).`] }); continue; }
      const ev = evaluate(d, ctx);
      if (ev.status === 'respinta') { report.push({ name: d.name, action: 'respinta', errors: ev.errors }); continue; }
      const res = upsertProspect(store, d, ev, { runId: run.id, today: today() });
      report.push({ name: d.name, ...res, status: ev.status, fit: ev.fit.score, entry: `${ev.entry.kind}${ev.entry.verified ? ' ✓' : ' ✗'}`, warnings: ev.warnings });
    }
    saveStore(STORE, store);
    writeJson(join(dir, 'ingest-report.json'), { at: today(), problems, report });
    for (const r of report) {
      console.log(`${r.action.padEnd(8)} ${r.name}${r.status ? ` — ${r.status}, fit ${r.fit}, via ${r.entry}` : ''}`);
      for (const e of r.errors ?? []) console.log(`           ERRORE ${e}`);
      for (const w of r.warnings ?? []) console.log(`           avviso ${w}`);
      if (r.possibleDuplicates?.length) console.log(`           possibile omonimia (non fusa): ${r.possibleDuplicates.join(', ')}`);
    }
    if (report.some((r) => r.action === 'respinta')) process.exitCode = 1;
  },

  /** Riapre in modo indipendente le fonti dichiarate «aperte» e annota l'esito. Non modifica la qualificazione. */
  async 'check-sources'(a) {
    const store = loadStore(STORE);
    const skip = /facebook\.com|instagram\.com|tiktok\.com/;
    for (const p of store.prospects.filter((x) => !a.run || x.runs.includes(a.run))) {
      p.sourceChecks ??= {};
      const tokens = [p.dossier.name, ...(p.dossier.aliases ?? [])].join(' ').toLowerCase().split(/[^a-zà-ú0-9]+/).filter((t) => t.length >= 5);
      for (const e of p.dossier.evidence.filter((x) => x.access === 'opened')) {
        let result;
        if (skip.test(e.url)) result = 'non controllabile senza accesso (social)';
        else {
          try {
            const res = await fetch(e.url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; LepefyGrowthCheck/0.1)', accept: 'text/html' } });
            const body = res.ok ? (await res.text()).toLowerCase() : '';
            result = !res.ok ? `HTTP ${res.status}` : tokens.some((t) => body.includes(t)) ? 'raggiungibile, nome presente' : 'raggiungibile, nome NON trovato nel testo';
          } catch (err) { result = `non raggiungibile (${err.name})`; }
        }
        p.sourceChecks[e.url] = { at: today(), result };
        console.log(`${p.id} · ${e.id} · ${result} · ${e.url}`);
      }
    }
    saveStore(STORE, store);
  },

  /** Shortlist in Markdown, CSV e JSON. */
  export(a) {
    const run = loadRun(a.run);
    const store = loadStore(STORE);
    const dir = runDir(run.id);
    const prospects = store.prospects.filter((p) => p.runs.includes(run.id));
    const discovery = existsSync(join(dir, 'discovery.json')) ? readJson(join(dir, 'discovery.json')) : null;
    const outcomes = loadOutcomes(OUTCOMES);
    const outDir = join(DATA, 'exports', run.id);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, 'shortlist.md'), toMarkdown({ prospects, discovery, run: { ...run, exportedAt: today() }, outcomes }));
    writeFileSync(join(outDir, 'shortlist.csv'), toCsv(prospects));
    writeJson(join(outDir, 'shortlist.json'), rank(prospects));
    console.log(JSON.stringify(funnel(prospects, discovery)));
    console.log(`Esportato in ${outDir}`);
  },

  /** Un unico file con tutte le schede dell'archivio, di tutti i giri: data/exports/tutte/. */
  'export:all'() {
    const store = loadStore(STORE);
    const runsDir = join(DATA, 'runs');
    const runIds = existsSync(runsDir) ? readdirSync(runsDir).filter((id) => existsSync(join(runsDir, id, 'run.json'))).sort() : [];
    const found = [];
    for (const id of runIds) {
      const p = join(runsDir, id, 'discovery.json');
      if (existsSync(p)) for (const c of readJson(p).found ?? []) found.push({ ...c, run: id });
    }
    const discovery = { found };
    const outcomes = loadOutcomes(OUTCOMES);
    const outDir = join(DATA, 'exports', 'tutte');
    mkdirSync(outDir, { recursive: true });
    const run = { id: 'tutte le schede', config: { area: `tutti i giri (${runIds.join(', ')})`, segment: 'come da ogni giro' }, exportedAt: today() };
    writeFileSync(join(outDir, 'shortlist.md'), toMarkdown({ prospects: store.prospects, discovery, run, outcomes }));
    writeFileSync(join(outDir, 'shortlist.csv'), toCsv(store.prospects));
    writeJson(join(outDir, 'shortlist.json'), rank(store.prospects));
    console.log(JSON.stringify(funnel(store.prospects, discovery)));
    console.log(`Esportate ${store.prospects.length} schede da ${runIds.length} giri in ${outDir}`);
  },

  /**
   * Invia l'archivio alla pagina admin /admin/platform/prospection e scarica le identità da non ricontattare.
   * Ambiente: GROWTH_INGEST_URL (…/api/internal/growth/ingest) e GROWTH_INGEST_TOKEN. Il server rivaluta ogni scheda.
   */
  async push(a) {
    const url = a.url ?? process.env.GROWTH_INGEST_URL;
    const token = process.env.GROWTH_INGEST_TOKEN;
    if (!url || !/^https?:\/\//.test(url)) throw new Error('GROWTH_INGEST_URL assente: indirizzo di …/api/internal/growth/ingest.');
    if (!token || token.length < 32) throw new Error('GROWTH_INGEST_TOKEN assente o troppo corto.');
    const defaults = readJson(join(ROOT, 'config', 'default.json'));
    const store = loadStore(STORE);
    const prospects = store.prospects.map((p) => ({ id: p.id, dossier: p.dossier, runs: p.runs, firstSeen: p.firstSeen, lastSeen: p.lastSeen }));
    if (a['dry-run']) { console.log(`${prospects.length} schede pronte per l'invio a ${new URL(url).host} (nessun invio).`); return; }
    const res = await fetch(url, {
      method: 'POST', signal: AbortSignal.timeout(60000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1, targetSegment: a.segment ?? defaults.segment, prospects }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Invio rifiutato: HTTP ${res.status} ${body.error ?? ''}`);
    writeJson(SUPPRESSIONS, { updatedAt: today(), keys: body.suppressionKeys ?? [] });
    console.log(`Importate ${body.imported} schede; rifiutate ${body.rejected?.length ?? 0}; escluse per richiesta di non contatto ${body.suppressed?.length ?? 0}.`);
    for (const r of body.rejected ?? []) console.log(`  rifiutata ${r.id}: ${(r.errors ?? []).join(' ')}`);
    console.log(`Identità da non ricontattare: ${(body.suppressionKeys ?? []).length} (salvate in ${SUPPRESSIONS}).`);
  },

  /** Registra un esito commerciale: growth outcome <id> --type demo [--reason ..] [--note ..] */
  outcome(a) {
    const store = loadStore(STORE);
    const row = recordOutcome(OUTCOMES, store, { id: a._[0], type: a.type, reason: a.reason, note: a.note, date: a.date ?? today() });
    console.log(`Esito registrato: ${JSON.stringify(row)}`);
  },

  outcomes() {
    console.log(JSON.stringify(summarizeOutcomes(loadStore(STORE), loadOutcomes(OUTCOMES)), null, 2));
    console.log(`Tipi ammessi: ${OUTCOME_TYPES.join(', ')}`);
  },

  list() {
    for (const p of rank(loadStore(STORE).prospects)) console.log(`${p.id.padEnd(48)} ${p.evaluation.status.padEnd(16)} fit ${String(p.evaluation.fit.score).padStart(3)}  via ${p.evaluation.entry.kind}${p.evaluation.entry.verified ? ' ✓' : ' ✗'}  visto ${p.lastSeen}`);
  },
};

const [cmd, ...rest] = process.argv.slice(2);
if (!commands[cmd]) {
  console.log(`Uso: node growth/cli.mjs <comando>\n  ${Object.keys(commands).join('\n  ')}\nVedi growth/README.md`);
  process.exitCode = cmd ? 1 : 0;
} else {
  try { await commands[cmd](args(rest)); } catch (err) { console.error(`ERRORE ${err.message}`); process.exitCode = 1; }
}
