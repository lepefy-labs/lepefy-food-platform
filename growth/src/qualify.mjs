// Validazione delle schede, segnali derivati dalle fonti, qualificazione su due
// dimensioni separate (fit commerciale / via d'ingresso) e controllo dei messaggi.
// L'agente scrive le schede; qui si decide cosa è sostenuto dalle fonti.

export const SIGNALS = ['specialtyFood', 'remoteSelling', 'chatOrders', 'catalogNoCheckout', 'shipping', 'pickup', 'active', 'ecommerce'];
export const ACCESS = ['opened', 'blocked', 'search_only'];
export const EVIDENCE_KINDS = ['official_site', 'social', 'press', 'event', 'association', 'directory', 'registry', 'search_result'];
const PRIMARY_KINDS = new Set(['official_site', 'social', 'press', 'event', 'association']);
export const ENTRY_KINDS = ['introduction', 'visit', 'event', 'inbound', 'written_channel', 'none'];
export const CHANNELS = { visit_opening: 500, intro_request: 800, whatsapp: 600, instagram_dm: 600, email: 1200, contact_form: 900 };

const FIT_POINTS = { specialtyFood: 25, remoteSelling: 25, chatOrders: 15, catalogNoCheckout: 25, shipping: 10, pickup: 5, active: 5 };
export const QUALIFY_MIN_FIT = 50;

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
const filled = (v) => typeof v === 'string' && v.trim().length > 0;

/** Stato di ogni segnale a partire dalle sole fonti: confirmed | indicated | contested | unknown. */
export function deriveSignals(d) {
  const out = {};
  for (const key of SIGNALS) {
    const ev = (d.evidence ?? []).filter((e) => e.access === 'opened');
    const support = ev.filter((e) => (e.supports ?? []).includes(key));
    const refute = ev.filter((e) => (e.refutes ?? []).includes(key));
    const primary = support.some((e) => PRIMARY_KINDS.has(e.kind));
    out[key] = support.length && refute.length ? 'contested' : primary ? 'confirmed' : support.length ? 'indicated' : 'unknown';
  }
  return out;
}

export function fitScore(d, signals) {
  const breakdown = [];
  for (const [key, points] of Object.entries(FIT_POINTS)) {
    const got = signals[key] === 'confirmed' ? points : signals[key] === 'indicated' ? Math.floor(points / 2) : 0;
    if (got) breakdown.push({ signal: key, state: signals[key], points: got });
  }
  let score = Math.min(100, breakdown.reduce((s, b) => s + b.points, 0));
  const notes = [];
  const need = d.ecommerceNeed;
  const needBacked = need && filled(need.text) && openedIds(d).some((id) => (need.evidence ?? []).includes(id));
  if (signals.ecommerce === 'confirmed' && !needBacked) {
    score = Math.min(score, 40);
    notes.push('Ha già un e-commerce e manca un\'esigenza specifica sostenuta da una fonte: fit limitato a 40.');
  }
  const selling = ['remoteSelling', 'chatOrders', 'catalogNoCheckout'].some((k) => signals[k] === 'confirmed');
  const food = ['confirmed', 'indicated'].includes(signals.specialtyFood);
  const qualified = score >= QUALIFY_MIN_FIT && selling && food;
  if (!selling) notes.push('Nessun segnale di vendita a distanza confermato da una fonte primaria aperta.');
  if (!food) notes.push('Specializzazione alimentare non sostenuta da una fonte aperta.');
  return { score, breakdown, qualified, notes };
}

function openedIds(d) {
  return (d.evidence ?? []).filter((e) => e.access === 'opened').map((e) => e.id);
}

/** Una via d'ingresso è verificata solo con una fonte aperta e le condizioni proprie del suo tipo. */
export function entryRoute(d, signals, today) {
  const e = d.entry ?? { kind: 'none' };
  const reasons = [];
  if (e.kind === 'none') return { kind: 'none', verified: false, reasons: ['Nessuna via d\'ingresso indicata.'] };
  const opened = openedIds(d);
  if (!(e.evidence ?? []).some((id) => opened.includes(id))) reasons.push('Nessuna fonte aperta a sostegno della via d\'ingresso.');
  if (e.kind === 'written_channel' && e.invitesBusinessContact !== true) {
    reasons.push('Un recapito pubblico non basta: serve evidenza che il canale sia aperto a richieste commerciali.');
  }
  if (e.kind === 'visit') {
    if (!filled(d.address)) reasons.push('Visita senza indirizzo verificato.');
    if (!['confirmed', 'indicated'].includes(signals.active)) reasons.push('Visita: attività non confermata come aperta.');
  }
  if (e.kind === 'event' && !(isDate(e.date) && e.date >= today)) reasons.push('Evento senza data futura verificata.');
  if (e.kind === 'introduction' && !filled(e.intermediary)) reasons.push('Presentazione senza intermediario identificato.');
  return { kind: e.kind, verified: reasons.length === 0, reasons };
}

// --- Messaggi -------------------------------------------------------------

const FORBIDDEN = [
  [/\d+\s?%/, 'percentuale non sostenuta'],
  [/€|\beuro\b|\bprezzo\b|\bcosta solo\b|\bgratis\b|\bgratuit/i, 'condizione commerciale o prezzo'],
  [/risparmi|guadagn|aument\w* (le |il )?(vendite|fatturato)|raddoppi|garanti/i, 'risultato promesso'],
  [/integrazion\w* (con |di )?whatsapp|whatsapp business api|bot (di )?whatsapp|automatic\w* (su|via|in) whatsapp|risposte automatiche/i, 'integrazione WhatsApp non disponibile'],
  [/(nostri|altri|molti|tanti) (clienti|negozi|commercianti)|come (fa|fanno) già|referenz/i, 'referenza non verificata'],
  [/\b(perdete|state perdendo|vi costa|fate fatica|siete costretti|il vostro problema|vous perdez)\b/i, 'problema attribuito senza conferma'],
];

// Frasi che affermano un fatto sul prospect (seconda persona): il fatto deve essere un segnale confermato.
const FACT_MARKER = /\b(ho visto|vedo che|ho letto|avete|vostr[oaie]|spedite|consegnate|ricevete|prendete|pubblicate|j'ai vu|vous avez|votre|vos|i saw|you have|your)\b/i;
const FACT_GATES = [
  [/sped\w+|consegn\w+|livr\w+|deliver\w+|shipping/i, ['shipping', 'remoteSelling'], 'spedizione/consegna'],
  [/whatsapp|chat\b/i, ['chatOrders'], 'ordini o richieste via chat'],
  [/catalogo|catalogue|listino/i, ['catalogNoCheckout', 'ecommerce'], 'catalogo pubblicato'],
  [/ritir\w+|retrait|pickup/i, ['pickup'], 'ritiro'],
  [/negozio online|e-?commerce|carrello|shop online|boutique en ligne/i, ['ecommerce'], 'e-commerce esistente'],
];

export function lintMessage(d, signals, features) {
  const errors = [];
  const m = d.message ?? {};
  const text = m.text ?? '';
  if (!filled(text)) return ['Messaggio assente.'];
  if (!(m.channel in CHANNELS)) errors.push(`Canale del messaggio non valido: ${m.channel}`);
  else if (text.length > CHANNELS[m.channel]) errors.push(`Messaggio troppo lungo per ${m.channel} (${text.length}/${CHANNELS[m.channel]}).`);
  if (!filled(m.language)) errors.push('Lingua del messaggio assente.');

  const opened = openedIds(d);
  if (!(m.claims ?? []).length) errors.push('Messaggio senza affermazioni dichiarate (claims).');
  let factual = 0;
  for (const c of m.claims ?? []) {
    if (c.feature) {
      if (!features[c.feature]) errors.push(`Funzione non presente nel catalogo Lepefy: ${c.feature}`);
      else if (!(d.lepefy?.featureIds ?? []).includes(c.feature)) errors.push(`Funzione citata ma non dichiarata nella scheda: ${c.feature}`);
    } else if ((c.evidence ?? []).length) {
      factual += 1;
      for (const id of c.evidence) if (!opened.includes(id)) errors.push(`Affermazione «${c.text}» basata su una fonte non aperta o inesistente (${id}).`);
    } else errors.push(`Affermazione senza fonte né funzione: «${c.text}»`);
  }
  if (!factual) errors.push('Il messaggio non parte da un fatto reale sostenuto da una fonte aperta.');

  for (const [re, label] of FORBIDDEN) if (re.test(text)) errors.push(`Contenuto non ammesso (${label}): «${text.match(re)[0]}»`);

  const sentences = text.split(/(?<=[.!?…])\s+|\n+/).filter(Boolean);
  for (const s of sentences) {
    if (!FACT_MARKER.test(s)) continue;
    for (const [re, keys, label] of FACT_GATES) {
      if (re.test(s) && !keys.some((k) => signals[k] === 'confirmed')) {
        errors.push(`Affermazione non sostenuta dalle fonti (${label}): «${s.trim()}»`);
      }
    }
  }
  const questions = (text.match(/\?/g) ?? []).length;
  if (questions !== 1) errors.push(`Il messaggio deve chiudere con una sola richiesta (punti interrogativi: ${questions}).`);
  else if (!/\?\s*["»”]?\s*$/.test(sentences[sentences.length - 1] ?? '') && !/\?/.test(sentences.slice(-2).join(' '))) errors.push('La richiesta deve stare in chiusura.');
  return errors;
}

// --- Scheda completa ------------------------------------------------------

export function evaluate(d, ctx) {
  const { features, today, targetSegment } = ctx;
  const errors = []; const warnings = [];
  for (const f of ['name', 'city', 'country', 'segment']) if (!filled(d[f])) errors.push(`Campo obbligatorio assente: ${f}`);

  const ids = new Set();
  if (!(d.evidence ?? []).length) errors.push('Nessuna fonte.');
  for (const e of d.evidence ?? []) {
    if (!filled(e.id) || ids.has(e.id)) errors.push(`Fonte senza id univoco: ${e.id}`);
    ids.add(e.id);
    if (!/^https?:\/\//.test(e.url ?? '')) errors.push(`Fonte ${e.id}: URL non valido.`);
    if (!isDate(e.checkedAt)) errors.push(`Fonte ${e.id}: data di verifica assente.`);
    if (!ACCESS.includes(e.access)) errors.push(`Fonte ${e.id}: accesso non valido.`);
    if (!EVIDENCE_KINDS.includes(e.kind)) errors.push(`Fonte ${e.id}: tipo non valido.`);
    if (!filled(e.note)) errors.push(`Fonte ${e.id}: evidenza breve assente.`);
    if (e.access !== 'opened' && ((e.supports ?? []).length || (e.refutes ?? []).length)) {
      warnings.push(`Fonte ${e.id} non aperta (${e.access}): non conferma nulla, i suoi segnali sono ignorati.`);
    }
  }
  if (!openedIds(d).length) errors.push('Nessuna fonte aperta: un risultato di ricerca non basta.');

  const signals = deriveSignals(d);
  for (const key of SIGNALS) {
    const declared = d.signals?.[key];
    if (declared === 'confirmed' && signals[key] !== 'confirmed') warnings.push(`Segnale ${key} dichiarato confermato ma dalle fonti risulta «${signals[key]}».`);
    if (signals[key] === 'contested') warnings.push(`Fonti in contraddizione su ${key}: da verificare.`);
  }

  if (!filled(d.verifiedFact?.text) || !(d.verifiedFact?.evidence ?? []).some((id) => openedIds(d).includes(id))) {
    errors.push('Fatto verificato assente o non sostenuto da una fonte aperta.');
  }
  if (!filled(d.hypothesis?.problem)) errors.push('Ipotesi di problema assente.');
  if (!/\?\s*$/.test(d.hypothesis?.question ?? '')) errors.push('Domanda di conferma assente.');
  if (!(d.lepefy?.featureIds ?? []).length || !filled(d.lepefy?.demoFlow)) errors.push('Funzionalità Lepefy o flusso demo assenti.');
  for (const id of d.lepefy?.featureIds ?? []) if (!features[id]) errors.push(`Funzionalità Lepefy inesistente nel catalogo: ${id}`);
  if (!ENTRY_KINDS.includes(d.entry?.kind)) errors.push('Via d\'ingresso assente o non valida.');
  if (!filled(d.entry?.nextAction)) errors.push('Prossima azione assente.');
  if (!['A', 'B', 'C'].includes(d.priority?.level) || !filled(d.priority?.reason)) errors.push('Priorità motivata assente.');
  if (!['alta', 'media', 'bassa'].includes(d.confidence)) errors.push('Livello di confidenza assente.');
  if (!Array.isArray(d.toVerify)) errors.push('Elenco dei dati da verificare assente.');
  errors.push(...lintMessage(d, signals, features));

  const fit = fitScore(d, signals);
  const entry = entryRoute(d, signals, today);
  const contested = SIGNALS.filter((k) => signals[k] === 'contested');
  let confidence = d.confidence;
  if (contested.length && confidence === 'alta') { confidence = 'media'; warnings.push('Confidenza ridotta a media per fonti in contraddizione.'); }

  let status;
  if (errors.length) status = 'respinta';
  else if (!fit.qualified) status = 'non_qualificata';
  else if (entry.verified) status = 'pronta';
  else status = 'da_coltivare';
  const separate = filled(d.segment) && d.segment !== targetSegment;

  return { errors, warnings, signals, fit, entry, status, separate, confidence, contested };
}
