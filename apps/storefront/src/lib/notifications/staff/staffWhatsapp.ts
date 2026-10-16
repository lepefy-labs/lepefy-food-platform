// Client-safe helpers of the staff WhatsApp channel (migration 158).

/** Release flag (tenant_feature_flags): WhatsApp staff notifications of a tenant. */
export const STAFF_WHATSAPP_FLAG = 'staff_whatsapp_notifications';

/**
 * Normalises an international number to E.164 (`+393331112222`). Accepts
 * spaces, dots, dashes, parentheses and a `00` prefix; refuses a national
 * number (no country guessed: the admin must type the international prefix).
 */
export function normalizeWhatsappPhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/[^0-9+\s().\-]/.test(trimmed)) return null;
  let compact = trimmed.replace(/[\s().\-]/g, '');
  if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
  return compact;
}

/** `+393331112222` → `+39 333 ••• 2222` (history, logs, previews). */
export function maskWhatsappPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '•••';
  return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ••• ${digits.slice(-4)}`;
}

/** Readable grouping for the admin form: `+39 333 111 2222`. */
export function formatWhatsappPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const rest = digits.slice(2);
  return `+${digits.slice(0, 2)} ${rest.replace(/(\d{3})(?=\d{4,})/g, '$1 ')}`.trim();
}
