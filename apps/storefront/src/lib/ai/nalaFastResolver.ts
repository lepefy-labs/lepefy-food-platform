import type { Tenant } from '@lepefy/types';

export type NalaFastStoreSubject = 'opening_hours' | 'address' | 'whatsapp';

export interface NalaFastStoreResolution {
  subject: NalaFastStoreSubject;
  reply: string;
}

type FastStoreTenant = Pick<Tenant,
  'click_collect_hours' | 'click_collect_hours_it' | 'click_collect_address' | 'whatsapp_number' | 'chatbox_extra_context'>;

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleaned(value: string | null | undefined, maxLength = 1200): string | null {
  if (!value) return null;
  const result = value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  return result || null;
}

function language(locale: string): 'fr' | 'it' | 'en' {
  const normalized = locale.toLowerCase();
  if (normalized.startsWith('it')) return 'it';
  if (normalized.startsWith('en')) return 'en';
  return 'fr';
}

function isOpeningHoursQuestion(message: string): boolean {
  const text = normalize(message);
  return [
    /\bhoraires?\b/,
    /\b(?:ouvrez|ouvrir|ouvert|ouverte|ouverts|ouverture|fermez|fermer|ferme|fermeture)\b/,
    /\b(?:quelle|quel|a quelle|a quel) heure\b.*\b(?:ouvr|ferm)/,
    /\b(?:ouvr|ferm)[a-z]*\b.*\bheure\b/,
    /\borari?\b/,
    /\b(?:aprite|aprire|aperto|aperti|apertura|chiudete|chiudere|chiuso|chiusura)\b/,
    /\ba che ora\b.*\b(?:apri|chiud)/,
    /\bopening hours?\b/,
    /\bwhat time\b.*\b(?:open|close)/,
    /\bwhen\b.*\b(?:open|close)/,
    /\b(?:are you|is the (?:shop|store)) open\b/,
    /\bclosing time\b/,
  ].some(pattern => pattern.test(text));
}

function isAddressQuestion(message: string): boolean {
  const text = normalize(message);
  return [
    /\badresse\b/,
    /\bou (?:etes|se trouve|est situe|est le magasin|est la boutique)\b/,
    /\bcomment (?:venir|vous trouver|arriver)\b/,
    /\bindirizzo\b/,
    /\bdove (?:siete|si trova|e il negozio)\b/,
    /\bcome (?:arrivare|trovarvi)\b/,
    /\baddress\b/,
    /\bwhere (?:are you|is the (?:shop|store))\b/,
    /\bhow do i get (?:there|to (?:the )?(?:shop|store))\b/,
  ].some(pattern => pattern.test(text));
}

function isWhatsappQuestion(message: string): boolean {
  const text = normalize(message);
  return [
    /\bwhatsapp\b/,
    /\b(?:telephone|numero de telephone|numero telephone|contacter|contact)\b/,
    /\b(?:telefono|numero di telefono|contatto|contattarvi)\b/,
    /\b(?:phone|phone number|contact number|contact you)\b/,
  ].some(pattern => pattern.test(text));
}

function extractOpeningHoursFromContext(context: string | null | undefined): string | null {
  if (!context) return null;
  const candidates = context
    .split(/(?:\r?\n)+|(?<=[.!?])\s+/)
    .map(segment => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 40);

  for (const candidate of candidates) {
    const text = normalize(candidate);
    const hasOpeningSignal = /\b(?:horaires?|ouvert|ouverte|ouverts|ouverture|ferme|fermeture|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|orari|aperto|apertura|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica|opening hours?|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text);
    const hasScheduleSignal = /\b\d{1,2}(?::\d{2}|h(?:\d{2})?)?\b/.test(text)
      || /\b(?:ferme|fermee|chiuso|chiusa|closed)\b/.test(text);
    if (hasOpeningSignal && hasScheduleSignal) return cleaned(candidate, 600);
  }
  return null;
}

function hoursReply(locale: string, hours: string): string {
  switch (language(locale)) {
    case 'it': return `I nostri orari sono: ${hours}`;
    case 'en': return `Our opening hours are: ${hours}`;
    default: return `Nos horaires sont : ${hours}`;
  }
}

function addressReply(locale: string, address: string): string {
  switch (language(locale)) {
    case 'it': return `Ci trovi qui: ${address}`;
    case 'en': return `You can find us at: ${address}`;
    default: return `Vous nous trouverez ici : ${address}`;
  }
}

function whatsappReply(locale: string, number: string): string {
  switch (language(locale)) {
    case 'it': return `Puoi contattarci su WhatsApp al ${number}.`;
    case 'en': return `You can contact us on WhatsApp at ${number}.`;
    default: return `Vous pouvez nous contacter sur WhatsApp au ${number}.`;
  }
}

/**
 * High-confidence, zero-inference resolver for authoritative tenant store information.
 * It deliberately returns null when either the intent or the tenant datum is uncertain,
 * allowing the normal retrieval + AI Core path to handle the request.
 */
export function resolveNalaFastStoreInformation(params: {
  message: string;
  locale: string;
  tenant: FastStoreTenant;
}): NalaFastStoreResolution | null {
  if (isOpeningHoursQuestion(params.message)) {
    const hours = cleaned(
      language(params.locale) === 'it'
        ? params.tenant.click_collect_hours_it ?? params.tenant.click_collect_hours
        : params.tenant.click_collect_hours ?? params.tenant.click_collect_hours_it,
    ) ?? extractOpeningHoursFromContext(params.tenant.chatbox_extra_context);
    return hours ? { subject: 'opening_hours', reply: hoursReply(params.locale, hours) } : null;
  }

  if (isAddressQuestion(params.message)) {
    const address = cleaned(params.tenant.click_collect_address, 500);
    return address ? { subject: 'address', reply: addressReply(params.locale, address) } : null;
  }

  if (isWhatsappQuestion(params.message)) {
    const number = cleaned(params.tenant.whatsapp_number, 80);
    return number ? { subject: 'whatsapp', reply: whatsappReply(params.locale, number) } : null;
  }

  return null;
}
