/**
 * Second line of defence before an event leaves the server (page, API, CSV).
 * The SQL side already stores only allow-listed values; historical sources
 * (adapters) were written by other modules, so their metadata is re-checked.
 */

const SECRET_KEY = /(secret|token|password|passwd|api_?key|iban|(^|_)bic($|_)|card|cvc|(^|_)pan($|_)|authorization|signature|email|e_mail|phone|recipients?|payload|address)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
const PHONE = /(?:\+|00)\d[\d\s.-]{7,}\d/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;

const MAX_STRING = 200;
const MAX_KEYS = 30;
const MAX_ITEMS = 30;
const MAX_DEPTH = 3;

export function maskText(value: string): string {
  return value
    .replace(EMAIL, '[e-mail masqué]')
    .replace(IBAN, '[IBAN masqué]')
    .replace(CARD, '[numéro masqué]')
    .replace(PHONE, '[téléphone masqué]')
    .slice(0, MAX_STRING);
}

export type SafeJson = string | number | boolean | null | SafeJson[] | { [key: string]: SafeJson };

/** Masked, bounded copy of untrusted JSON. Sensitive keys are dropped, not masked. */
export function sanitizeAuditJson(value: unknown, depth = 0): SafeJson {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return maskText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((item) => sanitizeAuditJson(item, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, SafeJson> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (SECRET_KEY.test(key)) continue;
      out[key] = sanitizeAuditJson(item, depth + 1);
    }
    return out;
  }
  return null;
}

export interface AuditChange {
  field: string;
  before?: SafeJson;
  after?: SafeJson;
  redacted?: boolean;
}

/** `changes` array → typed, masked entries; values of sensitive fields never pass. */
export function sanitizeChanges(value: unknown): AuditChange[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 60).flatMap((entry): AuditChange[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const field = typeof record.field === 'string' ? record.field.slice(0, 80) : null;
    if (!field) return [];
    if (record.redacted === true || SECRET_KEY.test(field)) return [{ field, redacted: true }];
    return [{ field, before: sanitizeAuditJson(record.before, 1), after: sanitizeAuditJson(record.after, 1) }];
  });
}
