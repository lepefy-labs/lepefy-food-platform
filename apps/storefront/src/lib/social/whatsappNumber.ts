/**
 * The shop WhatsApp number as `wa.me` needs it: international format, digits
 * only (E.164 without « + », 8 to 15 digits). Accepts what people type
 * (« +39 333 123 4567 », « 0039-333… »). Pure; tested in tests/unit/socialLinkUrl.spec.ts.
 */
export type WhatsappNumberResult = { ok: true; digits: string | null } | { ok: false; error: string };

export function normalizeWhatsappNumber(input: unknown): WhatsappNumberResult {
  if (input === null || input === undefined) return { ok: true, digits: null };
  if (typeof input !== 'string') return { ok: false, error: 'Numéro WhatsApp invalide.' };
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, digits: null };
  if (!/^[+\d\s().-]+$/.test(trimmed)) return { ok: false, error: 'Le numéro WhatsApp ne doit contenir que des chiffres (ex. +39 333 123 4567).' };
  let digits = trimmed.replace(/\D/g, '');
  if (!trimmed.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8 || digits.length > 15) {
    return { ok: false, error: 'Indiquez le numéro au format international, avec l’indicatif du pays (ex. +39 333 123 4567).' };
  }
  return { ok: true, digits };
}

export function whatsappLink(digits: string): string {
  return `https://wa.me/${digits}`;
}
