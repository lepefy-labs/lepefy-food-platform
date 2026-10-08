import type { ExternalCatalogSource } from './types';
import { ExternalCatalogError } from './types';

/**
 * Riconosce un link pubblico di catalogo WhatsApp Business:
 *   https://wa.me/c/<cifre>
 *   https://api.whatsapp.com/c/<cifre>   (stessa forma, dominio alternativo)
 *
 * Il segmento numerico è il numero del venditore in formato internazionale
 * senza "+": il chatId atteso da GREEN-API (`getProducts`) è `<cifre>@c.us`.
 * `chatIdOverride` permette di forzare un altro identificativo per la diagnosi
 * (es. un numero verificato manualmente) senza modificare il codice.
 */
const ALLOWED_HOSTS = new Set(['wa.me', 'www.wa.me', 'api.whatsapp.com']);

export function parseWhatsAppCatalogUrl(input: string, chatIdOverride?: string | null): ExternalCatalogSource {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new ExternalCatalogError('SOURCE_INVALID', 'URL del catalogo non valido.');
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ExternalCatalogError('SOURCE_INVALID', 'Sono accettati solo link https://wa.me/c/<numero>.');
  }
  const match = /^\/c\/(\d{6,20})\/?$/.exec(url.pathname);
  if (!match?.[1]) {
    throw new ExternalCatalogError('SOURCE_INVALID', 'Il link non ha la forma /c/<numero> di un catalogo WhatsApp Business.');
  }
  const catalogId = match[1];
  let chatId = `${catalogId}@c.us`;
  if (chatIdOverride) {
    if (!/^\d{6,20}@(c\.us|lid)$/.test(chatIdOverride)) {
      throw new ExternalCatalogError('SOURCE_INVALID', 'chatId forzato non valido (atteso <cifre>@c.us o <cifre>@lid).');
    }
    chatId = chatIdOverride;
  }
  return { url: `https://wa.me/c/${catalogId}`, catalogId, chatId };
}
