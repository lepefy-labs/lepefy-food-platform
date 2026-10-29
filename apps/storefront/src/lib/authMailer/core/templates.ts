import type { AuthEmailAction } from './payload';
import { DEFAULT_SENDER_NAME, sanitizeSenderName } from './sender';

export const MAIL_LANGUAGES = ['fr', 'it', 'en'] as const;
export type MailLanguage = (typeof MAIL_LANGUAGES)[number];
export const DEFAULT_MAIL_LANGUAGE: MailLanguage = 'fr';

export type MailPurpose = 'login' | 'admin_login' | 'delete_account' | 'reauthentication' | 'email_change' | 'invite' | 'recovery';

export interface MailBrand {
  /** Official tenant name, or "Lepefy" for platform sign-in. */
  name: string;
  logoUrl: string | null;
  color: string | null;
}

export interface RenderInput {
  purpose: MailPurpose;
  language: MailLanguage;
  brand: MailBrand;
  code?: string;
  link?: string;
  /** Minutes, shown only when the real Auth configuration is known. */
  expiryMinutes?: number | null;
}

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

export function resolveLanguage(candidates: Array<string | null | undefined>): MailLanguage {
  for (const c of candidates) {
    const base = (c ?? '').toLowerCase().split(/[-_]/)[0];
    if ((MAIL_LANGUAGES as readonly string[]).includes(base as string)) return base as MailLanguage;
  }
  return DEFAULT_MAIL_LANGUAGE;
}

export function purposeFor(action: AuthEmailAction, kind: string): MailPurpose {
  if (action === 'reauthentication') return 'reauthentication';
  if (action === 'email_change') return 'email_change';
  if (action === 'invite') return 'invite';
  if (action === 'recovery') return 'recovery';
  if (kind === 'deletion') return 'delete_account';
  return kind === 'admin' || kind === 'platform' ? 'admin_login' : 'login';
}

interface Copy {
  subject: (brand: string) => string;
  title: string;
  intro: (brand: string) => string;
  cta?: string;
  ignore: string;
  expiry: (m: number) => string;
  footer: string;
}

const COPY: Record<MailLanguage, Record<MailPurpose, Copy>> = {
  fr: {
    admin_login: { subject: () => 'Ton code de connexion admin', title: 'Connexion à l’administration', intro: (b) => `Voici ton code pour accéder à l’espace d’administration de ${b}.`, ignore: "Si tu n'as pas demandé ce code, tu peux ignorer cet e-mail.", expiry: (m) => `Ce code expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
    login: { subject: () => 'Ton code de connexion', title: 'Ton code de connexion', intro: (b) => `Voici ton code pour te connecter à ${b}.`, ignore: "Si tu n'as pas demandé ce code, tu peux ignorer cet e-mail.", expiry: (m) => `Ce code expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
    delete_account: { subject: () => 'Ton code pour supprimer ton compte', title: 'Suppression de ton compte', intro: (b) => `Voici ton code pour confirmer la suppression de ton compte ${b}.`, ignore: "Si tu n'as pas demandé la suppression de ton compte, ignore cet e-mail : rien ne sera supprimé.", expiry: (m) => `Ce code expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
    reauthentication: { subject: () => 'Ton code de confirmation', title: 'Ton code de confirmation', intro: (b) => `Voici ton code pour confirmer ton action sur ${b}.`, ignore: "Si tu n'as pas demandé ce code, tu peux ignorer cet e-mail.", expiry: (m) => `Ce code expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
    email_change: { subject: () => 'Confirme ton changement d’e-mail', title: 'Changement d’adresse e-mail', intro: (b) => `Voici ton code pour confirmer le changement d’adresse e-mail de ton compte ${b}.`, ignore: "Si tu n'es pas à l'origine de cette demande, ignore cet e-mail.", expiry: (m) => `Ce code expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
    invite: { subject: (b) => `Tu es invité(e) à rejoindre ${b}`, title: 'Ton invitation', intro: (b) => `Tu as été invité(e) à rejoindre l’équipe de ${b}.`, cta: 'Accepter l’invitation', ignore: "Si tu n'attendais pas cette invitation, ignore cet e-mail.", expiry: (m) => `Ce lien expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
    recovery: { subject: () => 'Réinitialise ton mot de passe', title: 'Réinitialisation du mot de passe', intro: (b) => `Utilise le bouton ci-dessous pour choisir un nouveau mot de passe pour ${b}.`, cta: 'Choisir un mot de passe', ignore: "Si tu n'as pas fait cette demande, ignore cet e-mail.", expiry: (m) => `Ce lien expire dans ${m} minutes.`, footer: 'Connexion sécurisée par Lepefy' },
  },
  it: {
    admin_login: { subject: () => 'Il tuo codice di accesso amministratore', title: 'Accesso all’amministrazione', intro: (b) => `Ecco il tuo codice per accedere all’area di amministrazione di ${b}.`, ignore: 'Se non hai richiesto questo codice, puoi ignorare questa e-mail.', expiry: (m) => `Il codice scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
    login: { subject: () => 'Il tuo codice di accesso', title: 'Il tuo codice di accesso', intro: (b) => `Ecco il tuo codice per accedere a ${b}.`, ignore: 'Se non hai richiesto questo codice, puoi ignorare questa e-mail.', expiry: (m) => `Il codice scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
    delete_account: { subject: () => 'Il tuo codice per eliminare l’account', title: 'Eliminazione del tuo account', intro: (b) => `Ecco il tuo codice per confermare l’eliminazione dell’account ${b}.`, ignore: 'Se non hai richiesto l’eliminazione, ignora questa e-mail: non verrà eliminato nulla.', expiry: (m) => `Il codice scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
    reauthentication: { subject: () => 'Il tuo codice di conferma', title: 'Il tuo codice di conferma', intro: (b) => `Ecco il tuo codice per confermare l’operazione su ${b}.`, ignore: 'Se non hai richiesto questo codice, puoi ignorare questa e-mail.', expiry: (m) => `Il codice scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
    email_change: { subject: () => 'Conferma il cambio di e-mail', title: 'Cambio dell’indirizzo e-mail', intro: (b) => `Ecco il tuo codice per confermare il cambio di indirizzo e-mail del tuo account ${b}.`, ignore: 'Se non hai fatto tu questa richiesta, ignora questa e-mail.', expiry: (m) => `Il codice scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
    invite: { subject: (b) => `Sei stato invitato in ${b}`, title: 'Il tuo invito', intro: (b) => `Sei stato invitato a far parte del team di ${b}.`, cta: 'Accetta l’invito', ignore: 'Se non aspettavi questo invito, ignora questa e-mail.', expiry: (m) => `Il link scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
    recovery: { subject: () => 'Reimposta la tua password', title: 'Reimpostazione della password', intro: (b) => `Usa il pulsante qui sotto per scegliere una nuova password per ${b}.`, cta: 'Scegli una password', ignore: 'Se non hai fatto tu questa richiesta, ignora questa e-mail.', expiry: (m) => `Il link scade tra ${m} minuti.`, footer: 'Accesso protetto da Lepefy' },
  },
  en: {
    admin_login: { subject: () => 'Your admin sign-in code', title: 'Admin sign-in', intro: (b) => `Here is your code to access the ${b} admin area.`, ignore: "If you didn't request this code, you can ignore this email.", expiry: (m) => `This code expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
    login: { subject: () => 'Your sign-in code', title: 'Your sign-in code', intro: (b) => `Here is your code to sign in to ${b}.`, ignore: "If you didn't request this code, you can ignore this email.", expiry: (m) => `This code expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
    delete_account: { subject: () => 'Your code to delete your account', title: 'Deleting your account', intro: (b) => `Here is your code to confirm the deletion of your ${b} account.`, ignore: "If you didn't ask to delete your account, ignore this email: nothing will be deleted.", expiry: (m) => `This code expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
    reauthentication: { subject: () => 'Your confirmation code', title: 'Your confirmation code', intro: (b) => `Here is your code to confirm your action on ${b}.`, ignore: "If you didn't request this code, you can ignore this email.", expiry: (m) => `This code expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
    email_change: { subject: () => 'Confirm your email change', title: 'Email address change', intro: (b) => `Here is your code to confirm the email address change on your ${b} account.`, ignore: "If you didn't make this request, ignore this email.", expiry: (m) => `This code expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
    invite: { subject: (b) => `You're invited to join ${b}`, title: 'Your invitation', intro: (b) => `You have been invited to join the ${b} team.`, cta: 'Accept the invitation', ignore: "If you weren't expecting this invitation, ignore this email.", expiry: (m) => `This link expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
    recovery: { subject: () => 'Reset your password', title: 'Password reset', intro: (b) => `Use the button below to choose a new password for ${b}.`, cta: 'Choose a password', ignore: "If you didn't make this request, ignore this email.", expiry: (m) => `This link expires in ${m} minutes.`, footer: 'Secure sign-in by Lepefy' },
  },
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const HEX_RE = /^#[0-9a-f]{6}$/i;
const FALLBACK_COLOR = '#111827';

export function safeColor(c: string | null | undefined): string {
  return c && HEX_RE.test(c.trim()) ? c.trim() : FALLBACK_COLOR;
}

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? '#111827' : '#ffffff';
}

/** Only https logos; anything else is dropped (no tracking, no mixed content). */
export function safeLogoUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function renderAuthEmail(input: RenderInput): RenderedMail {
  const brandName = sanitizeSenderName(input.brand.name) || DEFAULT_SENDER_NAME;
  const copy = COPY[input.language][input.purpose];
  const color = safeColor(input.brand.color);
  const on = readableOn(color);
  const logo = safeLogoUrl(input.brand.logoUrl);
  const expiry = input.expiryMinutes && input.expiryMinutes > 0 ? copy.expiry(Math.round(input.expiryMinutes)) : null;
  const subject = copy.subject(brandName);

  const header = logo
    ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(brandName)}" height="40" style="display:block;margin:0 auto;height:40px;max-width:200px;width:auto;border:0;">`
    : `<span style="font-size:20px;font-weight:700;color:${on};">${escapeHtml(brandName)}</span>`;

  let body: string;
  let textBody: string;
  if (input.code) {
    body = `<div style="margin:24px 0;padding:18px 12px;background:#f3f4f6;border-radius:8px;text-align:center;font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:8px;color:#111827;">${escapeHtml(input.code)}</div>`;
    textBody = input.code;
  } else {
    const href = input.link ?? '';
    body = `<div style="margin:24px 0;text-align:center;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 24px;background:${color};color:${on};border-radius:8px;font-weight:700;text-decoration:none;">${escapeHtml(copy.cta ?? '')}</a></div>`;
    textBody = href;
  }

  const html = `<!doctype html><html lang="${input.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td align="center" style="background:${color};padding:20px 16px;">${header}</td></tr>
<tr><td style="padding:28px 24px;">
<h1 style="margin:0 0 12px;font-size:22px;line-height:28px;color:#111827;">${escapeHtml(copy.title)}</h1>
<p style="margin:0;font-size:16px;line-height:24px;color:#374151;">${escapeHtml(copy.intro(brandName))}</p>
${body}
${expiry ? `<p style="margin:0 0 12px;font-size:14px;line-height:20px;color:#4b5563;">${escapeHtml(expiry)}</p>` : ''}
<p style="margin:0;font-size:14px;line-height:20px;color:#4b5563;">${escapeHtml(copy.ignore)}</p>
</td></tr>
<tr><td align="center" style="padding:16px;background:#f3f4f6;font-size:12px;line-height:16px;color:#6b7280;">${escapeHtml(copy.footer)}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [copy.title, '', copy.intro(brandName), '', textBody, '', ...(expiry ? [expiry] : []), copy.ignore, '', `— ${copy.footer}`].join('\n');
  return { subject, html, text };
}
