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
