import crypto from 'crypto';

/**
 * Quote di spedizione firmato (HMAC-SHA256).
 *
 * Il client non può essere fidato sul costo di spedizione: /api/shipping/quote
 * restituisce un token firmato che lega importo + destinazione + scadenza.
 * /api/checkout accetta lo shippingTotal solo se accompagnato da un token
 * valido e coerente con l'indirizzo di consegna.
 *
 * Segreto: TRACKING_SECRET (già richiesto per i link di tracking ordine).
 */

const QUOTE_TTL_MS = 60 * 60 * 1000; // 1h: copre il passaggio carrello → checkout

export interface QuotePayload {
  /** shippingTotal in EUR */
  t: number;
  /** country code destinazione (es. 'IT') */
  c: string;
  /** zip/postal code destinazione */
  z: string;
  /** scadenza epoch ms */
  e: number;
}

function hmac(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signQuote(
  shippingTotal: number,
  country: string,
  zipCode: string,
  secret: string,
): string {
  const payload: QuotePayload = {
    t: shippingTotal,
    c: country,
    z: zipCode,
    e: Date.now() + QUOTE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${hmac(encoded, secret)}`;
}

export type QuoteVerification =
  | { valid: true; payload: QuotePayload }
  | { valid: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyQuote(token: string, secret: string): QuoteVerification {
  // Un token V2 non è mai un token legacy (firma su un dominio distinto).
  if (isQuoteTokenV2(token)) return { valid: false, reason: 'malformed' };
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return { valid: false, reason: 'malformed' };

  const encoded   = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected  = hmac(encoded, secret);

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload: QuotePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  if (
    typeof payload.t !== 'number' ||
    typeof payload.c !== 'string' ||
    typeof payload.z !== 'string' ||
    typeof payload.e !== 'number'
  ) {
    return { valid: false, reason: 'malformed' };
  }

  if (Date.now() > payload.e) return { valid: false, reason: 'expired' };

  return { valid: true, payload };
}

// ─── Token V2 (forfait commerciale, V1G) ────────────────────────────────────
//
// Formato: `v2.<payload base64url>.<firma>`; la firma HMAC copre `v2.` + payload,
// quindi un token V2 non è mai un token legacy valido e viceversa. Il payload è
// costruito con chiavi in ordine fisso, importi e pesi interi (centesimi,
// grammi), CAP normalizzato e impronta canonica del carrello validato.

export type QuotePricingMode = 'tariff' | 'provider_cost';

export interface QuotePayloadV2 {
  v: 2;
  /** tenant */
  ten: string;
  /** importo spedizione, centesimi */
  t: number;
  c: string;
  /** CAP normalizzato */
  z: string;
  /** peso netto autorevole, grammi */
  w: number;
  /** impronta del carrello validato (cartFingerprint) */
  h: string;
  m: QuotePricingMode;
  /** versione tariffaria (null per provider_cost) */
  tid: string | null;
  tv: number | null;
  /** preventivo provider TTC in centesimi, se verificato al momento del quote */
  pq: number | null;
  /** origine della disponibilità logistica */
  av: string | null;
  /** corriere / servizio del preventivo provider (solo informativi) */
  cr: string | null;
  sv: string | null;
  e: number;
}

export type QuoteV2Input = Omit<QuotePayloadV2, 'v' | 'e'>;

export function normalizeQuotePostalCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Impronta deterministica delle quantità validate: indipendente dall'ordine delle righe. */
export function cartFingerprint(quantityByProduct: ReadonlyMap<string, number>): string {
  const canonical = [...quantityByProduct.entries()]
    .map(([id, qty]) => `${id}:${qty}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function isQuoteTokenV2(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith('v2.');
}

export function signQuoteV2(input: QuoteV2Input, secret: string, now = Date.now()): string {
  const payload: QuotePayloadV2 = {
    v: 2,
    ten: input.ten,
    t: input.t,
    c: input.c.trim().toUpperCase(),
    z: normalizeQuotePostalCode(input.z),
    w: input.w,
    h: input.h,
    m: input.m,
    tid: input.tid,
    tv: input.tv,
    pq: input.pq,
    av: input.av,
    cr: input.cr,
    sv: input.sv,
    e: now + QUOTE_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `v2.${encoded}.${hmac(`v2.${encoded}`, secret)}`;
}

export type QuoteVerificationV2 =
  | { valid: true; payload: QuotePayloadV2 }
  | { valid: false; reason: 'not_v2' | 'malformed' | 'bad_signature' | 'expired' };

export function verifyQuoteV2(token: string, secret: string, now = Date.now()): QuoteVerificationV2 {
  if (!isQuoteTokenV2(token)) return { valid: false, reason: 'not_v2' };
  const rest = token.slice(3);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return { valid: false, reason: 'malformed' };
  const encoded = rest.slice(0, dot);
  const signature = rest.slice(dot + 1);
  const expected = hmac(`v2.${encoded}`, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad_signature' };
  }
  let payload: QuotePayloadV2;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed' };
  }
  const intOrNull = (v: unknown) => v === null || Number.isInteger(v);
  const strOrNull = (v: unknown) => v === null || typeof v === 'string';
  if (payload?.v !== 2 || typeof payload.ten !== 'string' || !Number.isInteger(payload.t) || payload.t < 0
    || typeof payload.c !== 'string' || typeof payload.z !== 'string' || !Number.isInteger(payload.w)
    || typeof payload.h !== 'string' || (payload.m !== 'tariff' && payload.m !== 'provider_cost')
    || !strOrNull(payload.tid) || !intOrNull(payload.tv) || !intOrNull(payload.pq)
    || !strOrNull(payload.av) || !strOrNull(payload.cr) || !strOrNull(payload.sv) || typeof payload.e !== 'number') {
    return { valid: false, reason: 'malformed' };
  }
  if (now > payload.e) return { valid: false, reason: 'expired' };
  return { valid: true, payload };
}
