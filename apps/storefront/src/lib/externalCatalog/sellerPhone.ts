import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Numero WhatsApp del venditore → chatId GREEN-API `<cifre>@c.us`.
 * Accetta "+39 329 695 8822", "0039…", "39329…". Il link wa.me/c/ non basta:
 * contiene l'ID del catalogo, non il numero (verificato l'8/10/2026).
 */
export function sellerChatIdFromPhone(input: string): string | null {
  const trimmed = input.trim().replace(/^00/, '+');
  const phone = parsePhoneNumberFromString(trimmed.startsWith('+') ? trimmed : `+${trimmed}`);
  if (!phone?.isValid()) return null;
  return `${phone.number.replace(/^\+/, '')}@c.us`;
}
