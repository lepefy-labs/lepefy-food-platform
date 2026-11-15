import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compareIdentity, nameKey } from '../src/identity.mjs';
import { evaluate, deriveSignals } from '../src/qualify.mjs';
import { emptyStore, upsertProspect, recordOutcome, loadOutcomes, summarizeOutcomes } from '../src/store.mjs';
import { toMarkdown, toCsv, funnel } from '../src/exporter.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const features = JSON.parse(readFileSync(join(ROOT, 'config', 'features.json'), 'utf8')).features;
const ctx = { features, today: '2026-11-14', targetSegment: 'boutique-alimentare-africana' };

/** Scheda fittizia valida: i test la modificano un caso alla volta. */
function dossier(over = {}) {
  return {
    name: 'Mama Koko Market', aliases: [], city: 'Bologna', region: 'Emilia-Romagna', country: 'IT',
    segment: 'boutique-alimentare-africana', address: 'Via Esempio 12, Bologna',
    links: { website: 'https://mamakoko.example/' }, phones: ['+39 333 1112223'],
    evidence: [
      { id: 'e1', url: 'https://mamakoko.example/', checkedAt: '2026-11-14', access: 'opened', kind: 'official_site', supports: ['specialtyFood', 'remoteSelling', 'chatOrders', 'active'], note: 'Home: «ordina su WhatsApp, spediamo in Italia»' },
      { id: 'e2', url: 'https://festival.example/espositori', checkedAt: '2026-11-14', access: 'opened', kind: 'event', supports: ['active'], note: 'Elenco espositori 2026' },
    ],
    signals: {},
    verifiedFact: { text: 'Il sito invita a ordinare su WhatsApp con spedizione in Italia.', evidence: ['e1'] },
    hypothesis: { problem: 'Gli ordini in chat potrebbero richiedere passaggi manuali.', question: 'Come raccogliete oggi indirizzo e pagamento di un ordine arrivato in chat?' },
    lepefy: { featureIds: ['catalogo_checkout', 'contatto_whatsapp'], demoFlow: 'Ordine di prova da catalogo con contatto WhatsApp.' },
    entry: { kind: 'visit', detail: 'Negozio aperto al pubblico', evidence: ['e1'], nextAction: 'Passare in negozio martedì mattina.' },
    message: {
      language: 'it', channel: 'visit_opening',
      text: 'Buongiorno, ho visto sul vostro sito che prendete ordini su WhatsApp. Lavoro a una boutique online dove il cliente ordina dal catalogo e continua a scrivervi in chat. Le va di vedere in cinque minuti come arriverebbe un ordine di prova?',
      claims: [{ text: 'prendete ordini su WhatsApp', evidence: ['e1'] }, { text: 'ordina dal catalogo', feature: 'catalogo_checkout' }, { text: 'continua a scrivervi in chat', feature: 'contatto_whatsapp' }],
    },
    priority: { level: 'A', reason: 'Vende a distanza via chat e si può visitare.' }, confidence: 'alta', toVerify: [],
    ...over,
  };
}

test('scheda valida: pronta quando fit e via d\'ingresso sono entrambi verificati', () => {
  const ev = evaluate(dossier(), ctx);
  assert.deepEqual(ev.errors, []);
  assert.equal(ev.status, 'pronta');
  assert.equal(ev.fit.score, 70);
});

test('caso 1 — stessa azienda con nomi o link diversi viene riconosciuta', () => {
  const a = dossier();
  const sameDomain = dossier({ name: 'MamaKoko African Food', links: { website: 'http://www.mamakoko.example/shop' }, phones: [] });
  const samePhone = dossier({ name: 'Negozio di Koko', links: { facebook: 'https://www.facebook.com/kokoshop' }, phones: ['0039 3331112223'] });
  const sameName = dossier({ name: 'Mama Koko  Market S.r.l.', links: {}, phones: [], address: 'via Esempio, 12' });
  assert.equal(compareIdentity(a, sameDomain), 'same');
  assert.equal(compareIdentity(a, samePhone), 'same');
  assert.equal(compareIdentity(a, sameName), 'same');
  assert.equal(nameKey('Afro World'), nameKey('AfroWorld'));
  // omonimi nella stessa città ma a indirizzi diversi: mai fusi, solo segnalati
  const homonym = dossier({ links: {}, phones: [], address: 'Via Altra 8, Bologna' });
  assert.equal(compareIdentity(a, homonym), 'possible');
  assert.equal(compareIdentity(a, dossier({ name: 'Baobab Store', links: {}, phones: [], city: 'Parma' })), 'different');
});

test('caso 2a — una fonte non accessibile non conferma nulla', () => {
  const d = dossier();
  d.evidence[0] = { ...d.evidence[0], access: 'blocked' };
  d.entry.evidence = ['e2']; d.verifiedFact.evidence = ['e2']; d.message.claims[0].evidence = ['e2'];
  const ev = evaluate(d, ctx);
  assert.equal(ev.signals.remoteSelling, 'unknown');
  assert.equal(ev.fit.qualified, false);
  assert.ok(ev.warnings.some((w) => /non aperta/.test(w)));
  assert.ok(ev.errors.some((e) => /non sostenuta dalle fonti/.test(e)), 'il messaggio cita un fatto non più sostenuto');
});

test('caso 2b — due fonti in contraddizione: segnale contestato e confidenza ridotta', () => {
  const d = dossier();
  d.evidence.push({ id: 'e3', url: 'https://giornale.example/articolo', checkedAt: '2026-11-14', access: 'opened', kind: 'press', refutes: ['remoteSelling'], note: 'Articolo: «vendita solo in negozio»' });
  const ev = evaluate(d, ctx);
  assert.equal(ev.signals.remoteSelling, 'contested');
  assert.equal(ev.confidence, 'media');
  assert.ok(ev.warnings.some((w) => /contraddizione/.test(w)));
});

test('caso 2c — un elenco aziende da solo «indica», non conferma', () => {
  const d = dossier();
  d.evidence[0] = { ...d.evidence[0], kind: 'directory' };
  assert.equal(deriveSignals(d).remoteSelling, 'indicated');
});

test('caso 3 — ottimo fit senza via d\'ingresso verificata resta da coltivare', () => {
  const none = evaluate(dossier({ entry: { kind: 'none', nextAction: 'Cercare un intermediario.' } }), ctx);
  assert.equal(none.fit.qualified, true);
  assert.equal(none.status, 'da_coltivare');
  // un numero pubblico non è una via d'ingresso
  const phoneOnly = evaluate(dossier({ entry: { kind: 'written_channel', evidence: ['e1'], nextAction: 'Scrivere su WhatsApp.' } }), ctx);
  assert.equal(phoneOnly.status, 'da_coltivare');
  assert.ok(phoneOnly.entry.reasons.some((r) => /recapito pubblico non basta/.test(r)));
  const invited = evaluate(dossier({ entry: { kind: 'written_channel', invitesBusinessContact: true, evidence: ['e1'], nextAction: 'Scrivere dal modulo fornitori.' } }), ctx);
  assert.equal(invited.status, 'pronta');
});

test('caso 4 — e-commerce esistente: serve un\'esigenza specifica sostenuta da una fonte', () => {
  const d = dossier();
  d.evidence[0].supports.push('ecommerce');
  const capped = evaluate(d, ctx);
  assert.equal(capped.fit.score, 40);
  assert.equal(capped.status, 'non_qualificata');
  const withNeed = evaluate({ ...d, ecommerceNeed: { text: 'I prodotti fuori catalogo si chiedono con una foto su WhatsApp.', evidence: ['e1'] } }, ctx);
  assert.equal(withNeed.fit.qualified, true);
});

test('caso 5 — messaggio con affermazioni non sostenute viene respinto', () => {
  const cases = [
    ['Buongiorno, ho visto che spedite in tutta Europa con ritiro in negozio. Le va di vedere un ordine di prova?', /non sostenuta dalle fonti \(ritiro\)/],
    ['Buongiorno, ho visto che prendete ordini su WhatsApp. Con noi aumentate le vendite del 30%. Le va di vedere una demo?', /percentuale|risultato promesso/],
    ['Buongiorno, ho visto che prendete ordini su WhatsApp. Abbiamo una integrazione WhatsApp che risponde da sola. Le va di vedere una demo?', /integrazione WhatsApp/],
    ['Buongiorno, ho visto che prendete ordini su WhatsApp e so che perdete ordini ogni giorno. Le va di vedere una demo?', /problema attribuito/],
    ['Buongiorno, ho visto che prendete ordini su WhatsApp. Vuole una demo? Quando posso passare?', /una sola richiesta/],
  ];
  for (const [text, expected] of cases) {
    const d = dossier();
    d.message.text = text;
    const ev = evaluate(d, ctx);
    assert.equal(ev.status, 'respinta', text);
    assert.ok(ev.errors.some((e) => expected.test(e)), `${text} → ${ev.errors.join(' | ')}`);
  }
  const d = dossier();
  d.message.claims = [{ text: 'ordini su WhatsApp', evidence: ['e9'] }, { text: 'app mobile', feature: 'app_inesistente' }];
  const ev = evaluate(d, ctx);
  assert.ok(ev.errors.some((e) => /fonte non aperta o inesistente/.test(e)));
  assert.ok(ev.errors.some((e) => /non presente nel catalogo Lepefy/.test(e)));
});

test('caso 6 — una seconda esecuzione aggiorna la scheda senza duplicarla', () => {
  const store = emptyStore();
  const first = dossier();
  const r1 = upsertProspect(store, first, evaluate(first, ctx), { runId: 'run-1', today: '2026-11-14' });
  assert.equal(r1.action, 'created');

  const second = dossier({ name: 'MamaKoko African Food', links: { website: 'https://www.mamakoko.example/', instagram: 'https://www.instagram.com/mamakoko/' }, entry: { kind: 'none', nextAction: 'Cercare un intermediario.' } });
  second.evidence = [{ ...second.evidence[0], checkedAt: '2026-12-01', note: 'Home aggiornata' }];
  second.verifiedFact.evidence = ['e1'];
  const ctx2 = { ...ctx, today: '2026-12-01' };
  const r2 = upsertProspect(store, second, evaluate(second, ctx2), { runId: 'run-2', today: '2026-12-01' });

  assert.equal(r2.action, 'updated');
  assert.equal(r2.id, r1.id);
  assert.equal(store.prospects.length, 1);
  const p = store.prospects[0];
  assert.deepEqual(p.runs, ['run-1', 'run-2']);
  assert.equal(p.firstSeen, '2026-11-14');
  assert.equal(p.lastSeen, '2026-12-01');
  assert.ok(p.dossier.aliases.includes('Mama Koko Market'));
  assert.equal(p.dossier.evidence.find((e) => e.url === 'https://mamakoko.example/').checkedAt, '2026-12-01');
  assert.ok(p.dossier.evidence.some((e) => e.url === 'https://festival.example/espositori'), 'le fonti precedenti restano');
  assert.equal(p.history.length, 2, 'il cambio di stato pronta → da_coltivare è tracciato');
  assert.equal(p.evaluation.status, 'da_coltivare');

  // omonimo a un altro indirizzo: scheda distinta e segnalata
  const homonym = dossier({ links: {}, phones: [], address: 'Via Altra 8, Bologna' });
  const r3 = upsertProspect(store, homonym, evaluate(homonym, ctx2), { runId: 'run-2', today: '2026-12-01' });
  assert.equal(r3.action, 'created');
  assert.deepEqual(r3.possibleDuplicates, [r1.id]);
});

test('campi obbligatori: scheda senza fonti aperte o senza fatto verificato è respinta', () => {
  const d = dossier();
  d.evidence = d.evidence.map((e) => ({ ...e, access: 'search_only' }));
  const ev = evaluate(d, ctx);
  assert.equal(ev.status, 'respinta');
  assert.ok(ev.errors.some((e) => /un risultato di ricerca non basta/.test(e)));
  assert.ok(ev.errors.some((e) => /Fatto verificato/.test(e)));
});

test('segmento diverso: riportato a parte, fuori dalla classifica principale', () => {
  const store = emptyStore();
  const boutique = dossier();
  const catering = dossier({ name: 'Teranga Catering', segment: 'catering', links: {}, phones: [], address: 'Via Tre 3, Bologna' });
  for (const d of [boutique, catering]) upsertProspect(store, d, evaluate(d, ctx), { runId: 'r', today: '2026-11-14' });
  assert.equal(evaluate(catering, ctx).separate, true);
  assert.deepEqual(funnel(store.prospects, { found: [1, 2, 3, 4] }), { trovate: 4, schedate: 2, qualificate: 1, conViaIngresso: 1, segmentiSeparati: 1 });
  const md = toMarkdown({ prospects: store.prospects, discovery: { found: [] }, run: { id: 'r', config: { area: 'x', segment: 'y' }, exportedAt: '2026-11-14' }, outcomes: [] });
  assert.ok(md.indexOf('Segmenti separati') > md.indexOf('Mama Koko Market'));
  assert.ok(toCsv(store.prospects).split('\n').length >= 3);
  assert.ok(md.includes('+39 333 1112223'), 'telefono pubblico nella scheda Markdown');
  const csv = toCsv(store.prospects);
  assert.ok(csv.split('\n')[0].includes('telefoni') && csv.includes('+39 333 1112223'), 'colonna telefoni nel CSV');
});

test('esiti commerciali: registrazione, motivo obbligatorio per il rifiuto, riepilogo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'growth-'));
  const path = join(dir, 'outcomes.jsonl');
  const store = emptyStore();
  const d = dossier();
  const { id } = upsertProspect(store, d, evaluate(d, ctx), { runId: 'r', today: '2026-11-14' });
  recordOutcome(path, store, { id, type: 'contattato', date: '2026-11-15' });
  recordOutcome(path, store, { id, type: 'demo', date: '2026-11-20', note: 'in negozio' });
  assert.throws(() => recordOutcome(path, store, { id, type: 'rifiuto', date: '2026-11-21' }), /motivo/);
  assert.throws(() => recordOutcome(path, store, { id: 'ignoto', type: 'demo', date: '2026-11-21' }), /sconosciuto/);
  recordOutcome(path, store, { id, type: 'rifiuto', reason: 'lingua della boutique', date: '2026-11-21' });
  const s = summarizeOutcomes(store, loadOutcomes(path));
  assert.equal(s.stage.demo, 1);
  assert.equal(s.byEntry.visit.rifiuto, 1);
  assert.equal(s.refusals['lingua della boutique'], 1);
});

test('CLI end-to-end: run, budget, ingest, seconda esecuzione, export', () => {
  const data = mkdtempSync(join(tmpdir(), 'growth-cli-'));
  const env = { ...process.env, GROWTH_DATA_DIR: data, GROWTH_TODAY: '2026-11-14' };
  const cli = (...a) => spawnSync(process.execPath, [join(ROOT, 'cli.mjs'), ...a], { env, encoding: 'utf8' });
  assert.equal(cli('run:new', '--id', 't1', '--max-searches', '2').status, 0);
  const dir = join(data, 'runs', 't1'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dossiers.json'), JSON.stringify([dossier(), dossier({ name: 'MamaKoko' })]));
  writeFileSync(join(dir, 'discovery.json'), JSON.stringify({ searchLog: [{ q: 'a' }, { q: 'b' }, { q: 'c' }], pagesOpened: 3, found: [{ name: 'Mama Koko Market', outcome: 'schedata' }] }));
  const over = cli('ingest', '--run', 't1');
  assert.equal(over.status, 1);
  assert.match(over.stderr, /Budget ricerche superato/);
  assert.match(over.stderr, /Doppione nel lotto/);
  writeFileSync(join(dir, 'dossiers.json'), JSON.stringify([dossier()]));
  writeFileSync(join(dir, 'discovery.json'), JSON.stringify({ searchLog: [{ q: 'a' }], pagesOpened: 3, found: [{ name: 'Mama Koko Market', outcome: 'schedata' }, { name: 'Altro', city: 'Parma', outcome: 'esclusa', reason: 'solo ristorante' }] }));
  assert.equal(cli('ingest', '--run', 't1').status, 0);
  assert.equal(cli('run:new', '--id', 't2').status, 0);
  mkdirSync(join(data, 'runs', 't2'), { recursive: true });
  writeFileSync(join(data, 'runs', 't2', 'dossiers.json'), JSON.stringify([dossier({ name: 'Mama Koko' })]));
  writeFileSync(join(data, 'runs', 't2', 'discovery.json'), JSON.stringify({ searchLog: [{ q: 'a' }], pagesOpened: 1, found: [] }));
  const second = cli('ingest', '--run', 't2');
  assert.match(second.stdout, /updated/);
  assert.equal(JSON.parse(readFileSync(join(data, 'store.json'), 'utf8')).prospects.length, 1);
  const brief = cli('brief', '--run', 't2');
  assert.match(brief.stdout, /giaNote/);
  assert.equal(cli('export', '--run', 't1').status, 0);
  const md = readFileSync(join(data, 'exports', 't1', 'shortlist.md'), 'utf8');
  assert.match(md, /Da contattare per primi/);
  assert.match(md, /solo ristorante/);
  // A shop that asked not to be contacted (list downloaded by «push») is never filed again.
  writeFileSync(join(data, 'suppressions.json'), JSON.stringify({ keys: ['tel:3331112223'] }));
  assert.equal(cli('run:new', '--id', 't3').status, 0);
  mkdirSync(join(data, 'runs', 't3'), { recursive: true });
  writeFileSync(join(data, 'runs', 't3', 'dossiers.json'), JSON.stringify([dossier({ name: 'Koko Shop', links: {} })]));
  writeFileSync(join(data, 'runs', 't3', 'discovery.json'), JSON.stringify({ searchLog: [{ q: 'a' }], pagesOpened: 1, found: [] }));
  const third = cli('ingest', '--run', 't3');
  assert.match(third.stdout, /esclusa\s+Koko Shop/);
  assert.match(third.stdout, /non essere ricontattata/);
  assert.match(cli('brief', '--run', 't3').stdout, /tel:3331112223/);
  assert.match(cli('push').stderr, /GROWTH_INGEST_URL/);
  const all = cli('export:all');
  assert.equal(all.status, 0, all.stderr);
  const allMd = readFileSync(join(data, 'exports', 'tutte', 'shortlist.md'), 'utf8');
  assert.match(allMd, /giri: t1, t2/, 'una sola scheda, con entrambi i giri');
  assert.match(allMd, /\| Altro \| Parma \| t1 \| esclusa \| solo ristorante \|/);
  const allCsv = readFileSync(join(data, 'exports', 'tutte', 'shortlist.csv'), 'utf8').trim().split('\n');
  assert.equal(allCsv.length, 2, 'intestazione + una riga: nessun doppione tra i giri');
});
