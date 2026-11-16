/**
 * « Contacter sur WhatsApp » du détail commande (admin) : lien wa.me vers le
 * numéro du client, avec un premier message prérempli que l'équipe relit et
 * envoie depuis son propre WhatsApp. Rien ne part de Lepefy.
 *
 * Pur et client-safe, imports relatifs uniquement.
 */

import { parseStoredPhone } from '../phone/internationalPhone';
import type { OrderDataIssue } from './dataQuality/orderDataIssues';

/** Numéro WhatsApp (chiffres E.164 sans « + ») ou null si le numéro n'est pas valide. */
export function whatsappNumber(phone: string | null | undefined, defaultCountry: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const parsed = parseStoredPhone(phone, (defaultCountry || 'IT').toUpperCase());
  return parsed.e164 ? parsed.e164.replace(/\D/g, '') : null;
}

const firstName = (fullName: string | null | undefined) => {
  const word = fullName?.trim().split(/\s+/)[0] ?? '';
  return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : '';
};

/**
 * Premier message, en français : salutation + commande, puis la question à
 * poser quand le contrôle des données a relevé une anomalie d'adresse.
 */
export function whatsappContactMessage(input: {
  customerName: string | null | undefined;
  tenantName: string;
  orderReference: string;
  issues?: ReadonlyArray<Pick<OrderDataIssue, 'code'>>;
}): string {
  const name = firstName(input.customerName);
  const lines = [`Bonjour${name ? ` ${name}` : ''}, ici ${input.tenantName}, au sujet de votre commande ${input.orderReference}.`];
  const codes = new Set((input.issues ?? []).map((issue) => issue.code));
  const asks: string[] = [];
  if (codes.has('house_number_missing')) asks.push('le numéro de votre maison');
  if (codes.has('name_in_street')) asks.push('le nom exact de votre rue');
  if (codes.has('recipient_name_incomplete')) asks.push('le prénom et le nom du destinataire');
  if (asks.length > 0) {
    const list = asks.length === 1 ? asks[0] : `${asks.slice(0, -1).join(', ')} et ${asks[asks.length - 1]}`;
    lines.push(`Pour livrer votre colis, pourriez-vous nous indiquer ${list} ?`, 'Merci !');
  }
  return lines.join('\n');
}

/** https://wa.me/<numéro>?text=… ; null sans numéro valide. */
export function whatsappContactLink(number: string | null, message: string): string | null {
  if (!number || !/^\d{6,15}$/.test(number)) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
