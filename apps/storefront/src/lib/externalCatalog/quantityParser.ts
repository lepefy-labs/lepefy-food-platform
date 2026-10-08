import type {
  ExtractionConfidence,
  MeasureUnit,
  PackageTotal,
  QuantityExtraction,
  QuantityExtractor,
  ReviewReason,
  SellingModel,
  UnitFormat,
} from './types';

/**
 * Motore deterministico di interpretazione delle quantità nelle descrizioni
 * commerciali (FR / IT / EN). Nessun servizio esterno.
 *
 * Distingue quattro concetti che il testo tende a confondere:
 *   - package_count            : quante unità contiene il prodotto venduto ("4 paquets");
 *   - suggested_min_quantity   : minimo d'acquisto PROPOSTO (mai confermato qui);
 *   - suggested_quantity_step  : incremento proposto (solo se accompagna un minimo esplicito);
 *   - unit_format              : formato fisico della singola unità ("500 g").
 *
 * Regole:
 *   - un peso/volume da solo ("1 kg", "500 g") non produce MAI un minimo;
 *   - un conteggio strutturato ("4 paquets de 500g", "Lot de 6") propone un
 *     minimo = conteggio con motivo MIN_INFERRED_FROM_PACKAGE_COUNT, da confermare;
 *   - "venduto in confezioni da 3" / "par lots de 3" senza minimo esplicito resta
 *     ambiguo (minimo? step? contenuto?) → nessun minimo, revisione richiesta;
 *   - nessun prezzo unitario viene mai derivato dal prezzo mostrato.
 *
 * Il parser lavora per fasi con mascheramento: ogni frammento riconosciuto viene
 * sostituito da spazi (stessa lunghezza) così una fase successiva non lo
 * reinterpreta (es. "Minimum 2 pièces" non diventa anche un conteggio).
 */

export const DETERMINISTIC_EXTRACTOR_ID = 'deterministic-v1';

const LETTER_AHEAD = '(?![a-zà-ÿ])';
const UNIT = '(?:kilogrammes?|chilogrammi|kilos?|kg|grammes?|grammi|grams?|grs?|g|litres?|litri|liters?|lt|l|cl|ml)';
const SIZE = `(\\d+(?:[.,]\\d+)?)\\s*(${UNIT})${LETTER_AHEAD}`;
/** Un intero di conteggio: non decimale, non seguito da un'unità di misura né da una valuta. */
const NUM = `(\\d{1,4})(?![.,]?\\d)(?!\\s*${UNIT}${LETTER_AHEAD})(?!\\s*(?:€|eur|euros?|euro)${LETTER_AHEAD})`;
/** Come NUM ma ammette un'unità di misura subito dopo (per diagnosticare "minimum 500 g"). */
const NUM_ANY = `(\\d{1,4}(?:[.,]\\d+)?)(?![.,]?\\d)(\\s*${UNIT}${LETTER_AHEAD})?(?!\\s*(?:€|eur|euros?|euro)${LETTER_AHEAD})`;

const CONTAINER =
  '(?:paquets?|sachets?|bo[iî]tes?|bouteilles?|canettes?|bocaux|bocal|pots?|pi[eè]ces?|unit[eé]s?|barquettes?|briques?|tubes?' +
  '|confezioni|confezione|pacchetti|pacchetto|pacchi|pacco|bottiglie|bottiglia|lattine|lattina|barattoli|barattolo|pezzi|pezzo|unit[aà]|buste|busta|sacchetti|sacchetto' +
  '|packets?|packs?|bags?|bottles?|cans?|jars?|pieces?|pcs|units?|boxes|box|tins?)';
const LOT = '(?:lot|carton|colis|pack|caisse|fardeau|lotto|cartone|cassa|case|bundle|set|box)';
const PREP = "(?:de|d'|d’|da|di|of)";

// Fase 1 — minimo esplicito.
const MIN_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:minimum|minimo|min\\.?|moq)\\s*(?:de\\s+commande|d['’]ordine|d['’]acquisto|order|purchase)?\\s*(?:de|di|of|da)?\\s*[:=]?\\s*${NUM_ANY}(?:\\s*${CONTAINER}${LETTER_AHEAD})?`, 'g'),
  new RegExp(`\\b(?:commande|ordine|order|acquisto|achat)\\s+(?:minimum|minimale|minima|minimo|min\\.?)\\s*(?:de|di|of|da)?\\s*[:=]?\\s*${NUM_ANY}(?:\\s*${CONTAINER}${LETTER_AHEAD})?`, 'g'),
  // `\b` non funziona davanti a "à" (non è un carattere "word" in JS): lookbehind esplicito.
  new RegExp(`(?:(?<![a-zà-ÿ])[aà]\\s+partir\\s+de|\\balmeno|\\bat\\s+least)\\s+${NUM_ANY}(?:\\s*${CONTAINER}${LETTER_AHEAD})?`, 'g'),
];

// Fase 2 — frasi di raggruppamento: step se esiste un minimo esplicito, altrimenti ambigue.
const GROUPING_PATTERNS: RegExp[] = [
  new RegExp(`\\b(?:vendu(?:e|s|es)?\\s+)?par\\s+(?:lots?|multiples?|paquets?|cartons?|packs?|tranches?)\\s+${PREP}\\s*${NUM}`, 'g'),
  new RegExp(`\\bvendu(?:e|s|es)?\\s+(?:par|en)\\s+(?:lots?\\s+de\\s+|paquets?\\s+de\\s+|cartons?\\s+de\\s+)?${NUM}`, 'g'),
  new RegExp(`\\bpar\\s+${NUM}${LETTER_AHEAD}`, 'g'),
  new RegExp(`\\b(?:vendut[oaie]\\s+)?(?:in\\s+|a\\s+)?(?:confezion[ei]|lotti|multipli|cartoni|pacchi)\\s+(?:da|di)\\s+${NUM}`, 'g'),
  new RegExp(`\\b(?:sold\\s+)?in\\s+(?:multiples|steps|increments|lots|packs|cases|boxes)\\s+of\\s+${NUM}`, 'g'),
  new RegExp(`\\bincrements?\\s+of\\s+${NUM}`, 'g'),
];

// Fase 3 — conteggi strutturati (il prodotto contiene N unità).
const LOT_PATTERN = new RegExp(`\\b${LOT}\\s*${PREP}\\s*${NUM}(?:\\s*(${CONTAINER})${LETTER_AHEAD})?(?:\\s*(?:de|d'|d’|da|di|of|x|×)?\\s*${SIZE})?`, 'g');
const COUNT_CONTAINER_SIZE = new RegExp(`\\b${NUM}\\s*(?:[x×*]\\s*)?(${CONTAINER})${LETTER_AHEAD}\\s*(?:de|d'|d’|da|di|of|x|×)?\\s*${SIZE}`, 'g');
const COUNT_X_SIZE = new RegExp(`\\b${NUM}\\s*[x×*]\\s*${SIZE}`, 'g');
const SIZE_X_COUNT = new RegExp(`${SIZE}\\s*[x×*]\\s*${NUM}`, 'g');
const COUNT_CONTAINER = new RegExp(`\\b${NUM}\\s*(${CONTAINER})${LETTER_AHEAD}`, 'g');
const SIZE_ONLY = new RegExp(SIZE, 'g');
/**
 * Un solo imballo esterno dichiarato ("1 carton de Bobolo de 20 paquets"):
 * il conteggio interno è il contenuto dell'unità venduta, non un minimo.
 * Solo "1"/"un(e)/uno/una" espliciti: "a pack of 6" resta un lotto.
 */
const OUTER_SINGLE = /(?<![\d.,])(?:1|une?|uno|una)\s+(?:carton|lot|colis|caisse|fardeau|sac|cartone|cassa|sacco|case|box|bag)(?![a-zà-ÿ])/;

type CountKind = 'lot' | 'count_size' | 'count_only';

interface CountHit {
  count: number;
  format: UnitFormat | null;
  kind: CountKind;
  text: string;
}

export function normalizeMeasureUnit(raw: string): MeasureUnit {
  const u = raw.toLowerCase();
  if (/^(kg|kilos?|kilogrammes?|chilogrammi)$/.test(u)) return 'kg';
  if (/^(g|grs?|grammes?|grammi|grams?)$/.test(u)) return 'g';
  if (u === 'cl') return 'cl';
  if (u === 'ml') return 'ml';
  return 'l';
}

function parseDecimal(raw: string): number {
  return Number(raw.replace(',', '.'));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Converte un formato in grammi o millilitri; null per unità senza misura. */
export function toBaseQuantity(format: UnitFormat | null): PackageTotal | null {
  if (!format || format.value === null) return null;
  switch (format.unit) {
    case 'g':  return { value: round3(format.value), unit: 'g' };
    case 'kg': return { value: round3(format.value * 1000), unit: 'g' };
    case 'ml': return { value: round3(format.value), unit: 'ml' };
    case 'cl': return { value: round3(format.value * 10), unit: 'ml' };
    case 'l':  return { value: round3(format.value * 1000), unit: 'ml' };
    default:   return null;
  }
}

function sizeFormat(value: string | undefined, unit: string | undefined): UnitFormat | null {
  if (!value || !unit) return null;
  const n = parseDecimal(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return { value: n, unit: normalizeMeasureUnit(unit) };
}

function mask(text: string, start: number, length: number): string {
  return text.slice(0, start) + ' '.repeat(length) + text.slice(start + length);
}

/** Esegue `re` su `work`, restituisce i match e il testo con i match mascherati. */
function consume(work: string, re: RegExp): { work: string; hits: RegExpExecArray[] } {
  const hits: RegExpExecArray[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(work)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    hits.push(m);
  }
  let out = work;
  for (const h of hits) out = mask(out, h.index, h[0].length);
  return { work: out, hits };
}

function sameFormat(a: UnitFormat | null, b: UnitFormat | null): boolean {
  if (!a || !b) return a === b;
  const ba = toBaseQuantity(a);
  const bb = toBaseQuantity(b);
  if (ba && bb) return ba.unit === bb.unit && ba.value === bb.value;
  return a.unit === b.unit && a.value === b.value;
}

function reason(code: ReviewReason['code'], message: string): ReviewReason {
  return { code, message };
}

interface TextSignals {
  explicitMin: number | null;
  minAsMeasure: string | null;
  outerSingle: string | null;
  grouping: number[];
  counts: CountHit[];
  sizes: UnitFormat[];
  matches: string[];
}

function scanText(original: string): TextSignals {
  let work = original.toLowerCase().replace(/\s+/g, ' ');
  const outerSingle = OUTER_SINGLE.exec(work)?.[0] ?? null;
  const matches: string[] = [];
  let explicitMin: number | null = null;
  let minAsMeasure: string | null = null;

  for (const re of MIN_PATTERNS) {
    const r = consume(work, re);
    work = r.work;
    for (const h of r.hits) {
      matches.push(h[0].trim());
      if (h[2]) { minAsMeasure = h[0].trim(); continue; }          // "minimum 500 g" = misura, non conteggio
      const n = Number(h[1]);
      if (!Number.isInteger(n) || n < 1) continue;
      explicitMin = explicitMin === null ? n : Math.max(explicitMin, n);
    }
  }

  const grouping: number[] = [];
  for (const re of GROUPING_PATTERNS) {
    const r = consume(work, re);
    work = r.work;
    for (const h of r.hits) {
      const n = Number(h[1]);
      if (Number.isInteger(n) && n >= 1) { grouping.push(n); matches.push(h[0].trim()); }
    }
  }

  const counts: CountHit[] = [];
  const pushCount = (count: number, format: UnitFormat | null, kind: CountKind, text: string) => {
    if (!Number.isInteger(count) || count < 1) return;
    counts.push({ count, format, kind, text: text.trim() });
    matches.push(text.trim());
  };

  let r = consume(work, LOT_PATTERN);
  work = r.work;
  for (const h of r.hits) {
    const fmt = sizeFormat(h[3], h[4]) ?? (h[2] ? { value: null, unit: 'unit' as const } : null);
    pushCount(Number(h[1]), fmt ?? { value: null, unit: 'unit' }, 'lot', h[0]);
  }
  r = consume(work, COUNT_CONTAINER_SIZE);
  work = r.work;
  for (const h of r.hits) pushCount(Number(h[1]), sizeFormat(h[3], h[4]), 'count_size', h[0]);
  r = consume(work, COUNT_X_SIZE);
  work = r.work;
  for (const h of r.hits) pushCount(Number(h[1]), sizeFormat(h[2], h[3]), 'count_size', h[0]);
  r = consume(work, SIZE_X_COUNT);
  work = r.work;
  for (const h of r.hits) pushCount(Number(h[3]), sizeFormat(h[1], h[2]), 'count_size', h[0]);
  r = consume(work, COUNT_CONTAINER);
  work = r.work;
  for (const h of r.hits) pushCount(Number(h[1]), { value: null, unit: 'unit' }, 'count_only', h[0]);

  const sizes: UnitFormat[] = [];
  r = consume(work, SIZE_ONLY);
  for (const h of r.hits) {
    const f = sizeFormat(h[1], h[2]);
    if (f) { sizes.push(f); matches.push(h[0].trim()); }
  }

  return { explicitMin, minAsMeasure, outerSingle, grouping, counts, sizes, matches };
}

function hasSignal(s: TextSignals): boolean {
  return s.explicitMin !== null || s.minAsMeasure !== null || s.grouping.length > 0 || s.counts.length > 0 || s.sizes.length > 0;
}

function emptyExtraction(sourceField: QuantityExtraction['source_field'], model: SellingModel, reasons: ReviewReason[]): QuantityExtraction {
  return {
    package_count: null,
    unit_format: null,
    package_total: null,
    suggested_min_quantity: null,
    suggested_quantity_step: null,
    min_is_explicit: false,
    selling_model: model,
    confidence: 'none',
    reasons,
    matches: [],
    source_field: sourceField,
    extractor: DETERMINISTIC_EXTRACTOR_ID,
  };
}

/**
 * Interpreta un testo commerciale. `description` è la fonte primaria; il nome
 * viene usato solo se la descrizione non contiene alcun segnale quantitativo.
 */
export function extractQuantityInfo(input: { name: string | null; description: string | null }): QuantityExtraction {
  const description = input.description?.trim() || null;
  const name = input.name?.trim() || null;

  let signals: TextSignals | null = null;
  let sourceField: QuantityExtraction['source_field'] = null;
  if (description) {
    const s = scanText(description);
    if (hasSignal(s)) { signals = s; sourceField = 'description'; }
  }
  if (!signals && name) {
    const s = scanText(name);
    if (hasSignal(s)) { signals = s; sourceField = 'name'; }
  }

  if (!signals) {
    const noText = !description && !name;
    return emptyExtraction(null, noText ? 'unknown' : 'single_item', [
      reason('NO_QUANTITY_SIGNAL', 'Nessuna indicazione di quantità, lotto o formato riconosciuta nel testo.'),
    ]);
  }

  const reasons: ReviewReason[] = [];
  let confidence: ExtractionConfidence = 'none';
  let suggestedMin: number | null = null;
  let suggestedStep: number | null = null;
  let packageCount: number | null = null;
  let unitFormat: UnitFormat | null = null;
  let ambiguous = false;

  // Conteggi: un solo valore distinto è utilizzabile, più valori = conflitto.
  const distinctCounts = [...new Set(signals.counts.map((c) => c.count))];
  const primaryCount = signals.counts[0] ?? null;
  if (distinctCounts.length > 1) {
    ambiguous = true;
    reasons.push(reason('CONFLICTING_QUANTITIES',
      `Più quantità diverse nello stesso testo (${distinctCounts.join(', ')}): impossibile scegliere automaticamente.`));
  } else if (primaryCount) {
    packageCount = primaryCount.count;
  }

  // Formato della singola unità.
  const formats: UnitFormat[] = [];
  for (const c of signals.counts) if (c.format && c.format.value !== null) formats.push(c.format);
  const countSizedFormat = formats[0] ?? null;
  const total = packageCount !== null ? toBaseQuantity(countSizedFormat) : null;
  const packageTotal = total && packageCount !== null ? { value: round3(total.value * packageCount), unit: total.unit } : null;
  // Una misura isolata uguale al totale del lotto ("4 x 500 g (2 kg)") non è un conflitto.
  const looseSizes = signals.sizes.filter((s) => {
    const b = toBaseQuantity(s);
    return !(packageTotal && b && b.unit === packageTotal.unit && b.value === packageTotal.value);
  });
  const allFormats = [...formats, ...looseSizes];
  const distinctFormats = allFormats.filter((f, i) => allFormats.findIndex((g) => sameFormat(f, g)) === i);
  if (distinctFormats.length > 1) {
    ambiguous = true;
    reasons.push(reason('CONFLICTING_FORMATS', 'Più formati diversi nello stesso testo: formato non determinabile.'));
  } else if (distinctFormats[0]) {
    unitFormat = distinctFormats[0];
  } else if (primaryCount?.format) {
    unitFormat = primaryCount.format; // "Carton de 12 unités" → unità senza misura
  }

  if (signals.minAsMeasure) {
    reasons.push(reason('MIN_IS_MEASURE',
      `"${signals.minAsMeasure}" indica una misura, non un numero di pezzi: nessun minimo derivato.`));
  }

  // Minimo e step.
  if (signals.explicitMin !== null) {
    suggestedMin = signals.explicitMin;
    confidence = 'high';
    reasons.push(reason('MIN_EXPLICIT', `Minimo d'acquisto dichiarato esplicitamente nel testo (${signals.explicitMin}).`));
    const steps = [...new Set(signals.grouping)];
    if (steps.length === 1 && steps[0] !== undefined) {
      suggestedStep = steps[0];
      reasons.push(reason('STEP_EXPLICIT', `Incremento dichiarato nel testo (${steps[0]}).`));
    } else if (steps.length > 1) {
      ambiguous = true;
      reasons.push(reason('CONFLICTING_QUANTITIES', `Più incrementi diversi (${steps.join(', ')}).`));
    }
  } else if (signals.grouping.length > 0) {
    ambiguous = true;
    const n = signals.grouping[0] as number;
    if (packageCount === null && distinctCounts.length === 0) {
      packageCount = n;
      unitFormat = unitFormat ?? { value: null, unit: 'unit' };
    }
    reasons.push(reason('SALE_PACK_SIZE_AMBIGUOUS',
      `"Confezioni/lotti da ${n}" senza minimo esplicito: può indicare il contenuto della confezione, un minimo o un incremento. Da verificare.`));
  } else if (packageCount !== null && packageCount > 1 && !ambiguous && signals.outerSingle) {
    confidence = 'medium';
    reasons.push(reason('SINGLE_OUTER_PACKAGE',
      `"${signals.outerSingle}" indica un solo imballo venduto: ${packageCount} è il contenuto, non un minimo d'acquisto.`));
  } else if (packageCount !== null && packageCount > 1 && !ambiguous) {
    suggestedMin = packageCount;
    confidence = primaryCount?.kind === 'count_only' ? 'low' : 'medium';
    reasons.push(reason('MIN_INFERRED_FROM_PACKAGE_COUNT',
      `Quantità minima ${packageCount} proposta a partire da "${primaryCount?.text ?? ''}": è il numero di unità indicate, ` +
      'non un vincolo dichiarato. Confermare separatamente quantità minima e modello di prezzo.'));
  }

  if (ambiguous) confidence = 'low';

  const quantitySignal = suggestedMin !== null || (packageCount !== null && packageCount > 1) || signals.grouping.length > 0;
  if (quantitySignal) {
    reasons.push(reason('PRICE_MODEL_UNKNOWN',
      'Il prezzo mostrato può riferirsi al lotto intero o alla singola unità: nessun prezzo unitario è stato derivato.'));
  }
  if (!quantitySignal && !ambiguous && confidence === 'none') {
    reasons.push(reason('NO_QUANTITY_SIGNAL', 'Solo formato/misura: nessuna quantità minima inferibile.'));
  }

  const sellingModel: SellingModel = quantitySignal || ambiguous ? 'requires_review' : 'single_item';

  return {
    package_count: packageCount,
    unit_format: unitFormat,
    package_total: packageTotal,
    suggested_min_quantity: suggestedMin,
    suggested_quantity_step: suggestedStep,
    min_is_explicit: signals.explicitMin !== null,
    selling_model: sellingModel,
    confidence,
    reasons,
    matches: signals.matches,
    source_field: sourceField,
    extractor: DETERMINISTIC_EXTRACTOR_ID,
  };
}

export const deterministicQuantityExtractor: QuantityExtractor = {
  id: DETERMINISTIC_EXTRACTOR_ID,
  extract: extractQuantityInfo,
};
