import type { SalesStage, TouchOutcome } from './types';

/**
 * Contact rules of /admin/platform/prospection (pure, unit-tested). Lepefy
 * never sends anything: WhatsApp and e-mail open the platform owner's own app
 * with a prefilled text, a human presses « send », and only a confirmed send
 * is recorded. Whether a channel is offered is decided here, never in a component.
 */

/** Written channels must let the recipient say no in one sentence. */
export const OPT_OUT_SENTENCE: Record<string, string> = {
  fr: 'Si ce n’est pas pour vous, dites-le-moi et je ne vous écrirai plus.',
  it: 'Se non fa per voi, ditemelo e non vi scriverò più.',
  en: 'If this is not for you, just tell me and I will not write again.',
};
const OPT_OUT_PATTERN = /ne vous écrirai plus|ne vous recontacterai plus|non vi scriverò più|non vi ricontatterò|will not write again|won['’]t write again/i;

export function hasOptOut(text: string): boolean {
  return OPT_OUT_PATTERN.test(text);
}

/** Appends the opt-out sentence in the message language (French when unknown) unless already there. */
export function withOptOut(text: string, language: string): string {
  if (hasOptOut(text)) return text;
  const sentence = OPT_OUT_SENTENCE[language] ?? OPT_OUT_SENTENCE.fr;
  return `${text.trimEnd()}\n\n${sentence}`;
}

/** Above this many WhatsApp first messages a day the account risks being restricted. */
export const WHATSAPP_DAILY_SOFT_LIMIT = 10;

const COUNTRY_PREFIX: Record<string, string> = { FR: '33', IT: '39', BE: '32', CH: '41', DE: '49', ES: '34', LU: '352' };

/** International digits for wa.me (no +), or null when the number cannot be read. */
export function internationalDigits(phone: string, country: string): string | null {
  const raw = phone.trim();
  let digits = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) { /* already international */ }
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else {
    const prefix = COUNTRY_PREFIX[country];
    if (!prefix) return null;
    // FR/BE/CH/DE national numbers start with a trunk 0 that disappears abroad; IT numbers keep theirs.
    digits = prefix + (country === 'IT' ? digits : digits.replace(/^0/, ''));
  }
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** Fixed lines have no WhatsApp; unknown plans count as possible. */
export function isLikelyMobile(digits: string): boolean {
  if (digits.startsWith('33')) return /^33[67]/.test(digits);
  if (digits.startsWith('39')) return /^393/.test(digits);
  if (digits.startsWith('32')) return /^324/.test(digits);
  return true;
}

export function whatsappLink(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function mailtoLink(email: string, subject: string, text: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
}

export interface WhatsAppContext {
  country: string;
  doNotContact: boolean;
  stage: SalesStage;
  /** Contacts already recorded for this shop, any channel. */
  touches: number;
  /** WhatsApp contacts already recorded for this shop. */
  whatsappTouches: number;
  /** WhatsApp messages recorded today, all shops. */
  whatsappSentToday: number;
  /** The shop takes customer orders in chat: its public number is probably the order line. */
  chatOrdersConfirmed: boolean;
}

export interface WhatsAppDecision { allowed: boolean; blockedReason: string | null; warnings: string[] }

export function whatsappDecision(ctx: WhatsAppContext): WhatsAppDecision {
  const blocked = (reason: string): WhatsAppDecision => ({ allowed: false, blockedReason: reason, warnings: [] });
  if (ctx.doNotContact) return blocked('Ce commerce a demandé à ne plus être contacté.');
  if (ctx.stage === 'perso') return blocked('Le commerce a refusé : pas de nouveau message.');
  if (ctx.stage === 'cliente') return blocked('Déjà client : passez par l’assistance.');
  // A cold commercial WhatsApp is only planned for France; elsewhere it follows a first contact in person or by phone.
  if (ctx.country !== 'FR' && ctx.touches === 0) return blocked('Hors de France, pas de premier message WhatsApp : commencez par une visite ou un appel.');
  const warnings: string[] = [];
  if (ctx.chatOrdersConfirmed) warnings.push('Ce numéro est sans doute la ligne de commandes des clients : préférez la visite ou l’appel, ou soyez bref.');
  if (ctx.whatsappTouches >= 2) warnings.push('Déjà relancé sur WhatsApp : une seule relance au maximum.');
  if (ctx.whatsappSentToday >= WHATSAPP_DAILY_SOFT_LIMIT) warnings.push(`Déjà ${ctx.whatsappSentToday} messages WhatsApp aujourd’hui : au-delà de ${WHATSAPP_DAILY_SOFT_LIMIT}, le compte risque d’être restreint.`);
  return { allowed: true, blockedReason: null, warnings };
}

const STAGE_RANK: Record<SalesStage, number> = { perso: -1, da_contattare: 0, contattato: 1, in_conversazione: 2, demo: 3, cliente: 4 };

/** Stage after a recorded contact. Never moves backwards, except a refusal (perso) and a reply after a refusal. */
export function stageAfterTouch(current: SalesStage, outcome: TouchOutcome): SalesStage {
  const atLeast = (stage: SalesStage): SalesStage => (STAGE_RANK[current] >= STAGE_RANK[stage] ? current : stage);
  switch (outcome) {
    case 'contattato':
    case 'nessuna_risposta': return current === 'perso' ? current : atLeast('contattato');
    case 'introduzione':
    case 'risposta': return atLeast('in_conversazione');
    case 'demo': return atLeast('demo');
    case 'tenant_pagante': return 'cliente';
    case 'rifiuto': return current === 'cliente' ? current : 'perso';
  }
}

export const STAGE_LABEL: Record<SalesStage, string> = {
  da_contattare: 'À contacter',
  contattato: 'Contacté',
  in_conversazione: 'En discussion',
  demo: 'Démo',
  cliente: 'Client',
  perso: 'Refus',
};

export const OUTCOME_LABEL: Record<TouchOutcome, string> = {
  contattato: 'Premier contact',
  introduzione: 'Présentation obtenue',
  risposta: 'Réponse reçue',
  demo: 'Démo faite',
  rifiuto: 'Refus',
  nessuna_risposta: 'Pas de réponse',
  tenant_pagante: 'Client payant',
};

export const CHANNEL_LABEL: Record<string, string> = {
  visita: 'Visite', telefono: 'Téléphone', whatsapp: 'WhatsApp', email: 'E-mail', instagram: 'Instagram',
  modulo: 'Formulaire', presentazione: 'Présentation', altro: 'Autre',
};
