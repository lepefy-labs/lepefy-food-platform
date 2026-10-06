/**
 * Canaux « Besoin d'aide ? » du portail commande, dérivés uniquement de la
 * configuration du tenant (aucun numéro en dur). Ordre : WhatsApp, e-mail,
 * boutique. Le message prérempli ne contient que la référence courte.
 */
export type SupportChannelKind = 'whatsapp' | 'email' | 'shop';

export interface SupportChannel {
  kind: SupportChannelKind;
  label: string;
  href: string;
  /** Valeur lisible (numéro, adresse) affichée à côté du bouton. */
  detail: string | null;
}

export interface SupportTenant {
  whatsapp_number: string | null;
  legal_email: string | null;
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/**
 * Numéro WhatsApp lisible : préfixe « + » ajouté à un numéro international saisi
 * sans lui (« 393296958822 » → « +393296958822 »). Un numéro national (« 06… »)
 * ou déjà préfixé reste tel quel ; aucun regroupement de chiffres inventé.
 */
export function formatWhatsappDisplay(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('+') || value.startsWith('0')) return value;
  return /^[\d\s.-]+$/.test(value) && whatsappDigits(value) ? `+${value}` : value;
}

export function buildSupportChannels(tenant: SupportTenant, orderRef: string, shopBaseUrl: string | null): SupportChannel[] {
  const channels: SupportChannel[] = [];
  const message = `Bonjour, j’ai une question sur ma commande #${orderRef}.`;
  const wa = whatsappDigits(tenant.whatsapp_number);
  if (wa) channels.push({ kind: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${wa}?text=${encodeURIComponent(message)}`, detail: formatWhatsappDisplay(tenant.whatsapp_number) });
  const email = tenant.legal_email?.trim();
  if (email && EMAIL.test(email)) {
    channels.push({ kind: 'email', label: 'E-mail', href: `mailto:${email}?subject=${encodeURIComponent(`Commande #${orderRef}`)}`, detail: email });
  }
  if (shopBaseUrl) channels.push({ kind: 'shop', label: 'Aller sur la boutique', href: shopBaseUrl.replace(/\/+$/, '') || '/', detail: null });
  return channels;
}
