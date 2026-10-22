import 'server-only';
import { SUPPORT_LIMITS } from '../domain';
import { cleanMessageBody, isMeaningfulText, isUuid } from '../rules';

/** Shared parsing of the write bodies (shop and console). */

export function parseMessageText(value: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = cleanMessageBody(value);
  if (!isMeaningfulText(text, SUPPORT_LIMITS.bodyMin)) return { ok: false, error: 'Écrivez quelques mots pour expliquer la situation.' };
  if (text.length > SUPPORT_LIMITS.bodyMax) return { ok: false, error: 'Message trop long : 5 000 caractères au maximum.' };
  return { ok: true, text };
}

/** Up to 5 distinct attachment ids; anything else is rejected. */
export function parseAttachmentIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > SUPPORT_LIMITS.attachmentsPerMessage || !value.every(isUuid)) return null;
  return Array.from(new Set(value.map((id) => id.toLowerCase())));
}

export function parseClientKey(value: unknown): string | null {
  return isUuid(value) ? value.toLowerCase() : null;
}

export function appVersion(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
}
