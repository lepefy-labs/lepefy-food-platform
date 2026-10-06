import type { OrderPortalViewModel } from '@/lib/orders/portal/portalViewModel';
import type { WhatsAppHandoffReason } from '@/lib/whatsapp/types';

/**
 * Textes des réponses automatiques WhatsApp (texte brut WhatsApp, FR / IT / EN).
 * Génériques : toute donnée affichée (nom, horaires, livraison, commande)
 * provient des données Lepefy du tenant, jamais d'une valeur codée en dur.
 */

export type ReplyLanguage = 'fr' | 'it' | 'en';

export function replyLanguage(value: string | null | undefined): ReplyLanguage {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.startsWith('it')) return 'it';
  if (normalized.startsWith('en')) return 'en';
  return 'fr';
}

type Copy = Record<ReplyLanguage, string>;
const pick = (copy: Copy, lang: ReplyLanguage) => copy[lang];

/** Markdown léger (Nala, mémoire de réponses) -> mise en forme WhatsApp. */
export function toWhatsAppText(value: string): string {
  return value
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/\[([^\]]{1,120})\]\((https?:\/\/[^)\s]{1,300})\)/g, '$1 : $2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

export function greetingReply(lang: ReplyLanguage, tenantName: string, configured?: string): string {
  if (configured) return configured.replace(/\{boutique\}/g, tenantName);
  return pick({
    fr: `Bonjour 👋 Bienvenue chez ${tenantName} ! Comment pouvons-nous vous aider ?`,
    it: `Ciao 👋 Benvenuto da ${tenantName}! Come possiamo aiutarti?`,
    en: `Hello 👋 Welcome to ${tenantName}! How can we help you?`,
  }, lang);
}

export function handoffReply(lang: ReplyLanguage, reason: WhatsAppHandoffReason, tenantName: string, configured?: string): string {
  if (configured) return configured.replace(/\{boutique\}/g, tenantName);
  if (reason === 'media_message') {
    return pick({
      fr: 'Merci, nous avons bien reçu votre message. Un membre de l’équipe va le consulter et vous répondre.',
      it: 'Grazie, abbiamo ricevuto il tuo messaggio. Un membro del team lo vedrà e ti risponderà.',
      en: 'Thanks, we received your message. A team member will look at it and reply to you.',
    }, lang);
  }
  return pick({
    fr: `Je transmets votre demande à l’équipe ${tenantName}. Une personne vous répond ici dès que possible.`,
    it: `Inoltro la tua richiesta al team di ${tenantName}. Una persona ti risponderà qui il prima possibile.`,
    en: `I’m passing your request to the ${tenantName} team. Someone will reply here as soon as possible.`,
  }, lang);
}

export function fallbackReply(lang: ReplyLanguage, tenantName: string, storefrontUrl: string | null): string {
  const link = storefrontUrl ? `\n${storefrontUrl}` : '';
  return pick({
    fr: `Merci pour votre message ! Je ne peux pas y répondre automatiquement. L’équipe ${tenantName} vous répondra dès que possible.${link}`,
    it: `Grazie per il messaggio! Non posso rispondere automaticamente. Il team di ${tenantName} ti risponderà appena possibile.${link}`,
    en: `Thanks for your message! I can’t answer it automatically. The ${tenantName} team will reply as soon as possible.${link}`,
  }, lang);
}

export function catalogReply(lang: ReplyLanguage, url: string): string {
  return pick({
    fr: `Retrouvez tous nos produits et commandez en ligne ici : ${url}`,
    it: `Trovi tutti i nostri prodotti e puoi ordinare online qui: ${url}`,
    en: `You can browse all our products and order online here: ${url}`,
  }, lang);
}

export function withProductLink(reply: string, lang: ReplyLanguage, url: string | null): string {
  if (!url) return reply;
  return `${reply}\n${pick({ fr: 'Voir le produit', it: 'Vedi il prodotto', en: 'See the product' }, lang)} : ${url}`;
}

export interface ShippingFacts {
  provider: 'packlink' | 'flat_rate' | 'pickup_only';
  flatRateAmount: number | null;
  currency: string;
  pickupAddress: string | null;
  publicGridUrl: string | null;
  extraNote?: string;
}

function money(amount: number, currency: string, lang: ReplyLanguage): string {
  const locale = lang === 'it' ? 'it-IT' : lang === 'en' ? 'en-GB' : 'fr-FR';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}

/** Réponse livraison construite uniquement à partir de la configuration réelle du tenant. */
export function shippingReply(lang: ReplyLanguage, facts: ShippingFacts): string {
  const lines: string[] = [];
  if (facts.provider === 'pickup_only') {
    lines.push(pick({
      fr: 'Nous ne livrons pas pour le moment : les commandes sont à retirer en boutique.',
      it: 'Al momento non effettuiamo consegne: gli ordini si ritirano in negozio.',
      en: 'We don’t deliver at the moment: orders are collected in store.',
    }, lang));
  } else if (facts.provider === 'flat_rate' && facts.flatRateAmount != null) {
    const amount = money(facts.flatRateAmount, facts.currency, lang);
    lines.push(pick({
      fr: `Livraison à domicile : forfait de ${amount}.`,
      it: `Consegna a domicilio: tariffa fissa di ${amount}.`,
      en: `Home delivery: flat rate of ${amount}.`,
    }, lang));
  } else {
    lines.push(pick({
      fr: 'Nous livrons à domicile. Les frais sont calculés automatiquement à la commande, selon le poids du colis et l’adresse de livraison.',
      it: 'Consegniamo a domicilio. Le spese vengono calcolate automaticamente al momento dell’ordine, in base al peso del pacco e all’indirizzo.',
      en: 'We deliver to your home. Shipping costs are calculated automatically at checkout, based on parcel weight and delivery address.',
    }, lang));
  }
  if (facts.pickupAddress) {
    lines.push(pick({
      fr: `Retrait possible en boutique : ${facts.pickupAddress}`,
      it: `Ritiro possibile in negozio: ${facts.pickupAddress}`,
      en: `In-store pickup available: ${facts.pickupAddress}`,
    }, lang));
  }
  if (facts.publicGridUrl) {
    lines.push(pick({ fr: 'Détails et tarifs', it: 'Dettagli e tariffe', en: 'Details and rates' }, lang) + ` : ${facts.publicGridUrl}`);
  }
  if (facts.extraNote) lines.push(facts.extraNote);
  return lines.join('\n');
}

export function orderNotFoundReply(lang: ReplyLanguage): string {
  return pick({
    fr: 'Je ne trouve pas de commande associée à ce numéro WhatsApp. Pour votre sécurité, je ne peux donner d’informations que sur les commandes passées avec ce numéro.',
    it: 'Non trovo ordini associati a questo numero WhatsApp. Per sicurezza posso dare informazioni solo sugli ordini effettuati con questo numero.',
    en: 'I can’t find an order linked to this WhatsApp number. For your security, I can only share details of orders placed with this number.',
  }, lang);
}

export function orderStatusReply(lang: ReplyLanguage, order: OrderPortalViewModel, portalUrl: string | null): string {
  const head = pick({
    fr: `Commande ${order.ref} du ${order.date} : *${order.stageLabel}*`,
    it: `Ordine ${order.ref} del ${order.date}: *${order.stageLabel}*`,
    en: `Order ${order.ref} (${order.date}): *${order.stageLabel}*`,
  }, lang);
  const lines = [head];
  if (lang === 'fr' && order.description) lines.push(order.description);
  if (order.shipment?.status) lines.push(`${pick({ fr: 'Transporteur', it: 'Corriere', en: 'Carrier' }, lang)} : ${[order.shipment.carrier, order.shipment.status].filter(Boolean).join(' — ')}`);
  if (order.shipment?.eta) lines.push(`${pick({ fr: 'Livraison estimée', it: 'Consegna prevista', en: 'Estimated delivery' }, lang)} : ${order.shipment.eta}`);
  if (order.pickup) lines.push(`${pick({ fr: 'Retrait', it: 'Ritiro', en: 'Pickup' }, lang)} : ${order.pickup.address}`);
  if (portalUrl) lines.push(`${pick({ fr: 'Détails', it: 'Dettagli', en: 'Details' }, lang)} : ${portalUrl}`);
  return lines.join('\n');
}

export function trackingReply(lang: ReplyLanguage, order: OrderPortalViewModel, portalUrl: string | null): string {
  const trackCta = [order.primary, ...order.secondary].find((cta) => cta?.kind === 'track');
  const track = trackCta?.kind === 'track' ? trackCta.href : null;
  if (!order.shipment) {
    const pending = pick({
      fr: `Commande ${order.ref} : *${order.stageLabel}*. Le suivi transporteur sera disponible dès l’expédition.`,
      it: `Ordine ${order.ref}: *${order.stageLabel}*. Il tracciamento sarà disponibile dalla spedizione.`,
      en: `Order ${order.ref}: *${order.stageLabel}*. Tracking will be available once shipped.`,
    }, lang);
    return portalUrl ? `${pending}\n${portalUrl}` : pending;
  }
  const lines = [pick({ fr: `Suivi de la commande ${order.ref}`, it: `Tracciamento ordine ${order.ref}`, en: `Tracking for order ${order.ref}` }, lang)];
  if (order.shipment.carrier) lines.push(`${pick({ fr: 'Transporteur', it: 'Corriere', en: 'Carrier' }, lang)} : ${order.shipment.carrier}`);
  if (order.shipment.status) lines.push(`${pick({ fr: 'Statut', it: 'Stato', en: 'Status' }, lang)} : ${order.shipment.status}`);
  if (order.shipment.lastUpdate) lines.push(`${pick({ fr: 'Dernière mise à jour', it: 'Ultimo aggiornamento', en: 'Last update' }, lang)} : ${order.shipment.lastUpdate}`);
  if (order.shipment.eta) lines.push(`${pick({ fr: 'Livraison estimée', it: 'Consegna prevista', en: 'Estimated delivery' }, lang)} : ${order.shipment.eta}`);
  if (order.shipment.trackingCode) lines.push(`${pick({ fr: 'N° de suivi', it: 'Codice', en: 'Tracking no.' }, lang)} : ${order.shipment.trackingCode}`);
  if (track) lines.push(track);
  else if (portalUrl) lines.push(portalUrl);
  return lines.join('\n');
}
