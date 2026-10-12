/**
 * Supplément de livraison de la location de matériel : état à la création de
 * la réservation, contrôle du montant saisi par l'admin, message au client.
 * Fonctions pures, imports relatifs uniquement.
 */

export const DELIVERY_FEE_MAX = 10000;

export type InitialDeliveryFee = {
  status: 'not_applicable' | 'pending_quote' | 'paid';
  amount: number | null;
};

/**
 * Au checkout (Stripe ou lien externe), le supplément de la zone trouvée est
 * ajouté au total payé : il est donc déjà payé. Sans zone, le client n'a payé
 * que le matériel (les checkouts envoient alors 0) et le supplément reste à
 * chiffrer par l'équipe. Un montant positif compte aussi comme payé : la zone
 * a pu être supprimée entre le checkout et la confirmation (FK set null).
 */
export function initialDeliveryFee(input: {
  fulfillmentType: string;
  deliveryZoneId?: string | null;
  deliveryFeeAmount?: number | null;
}): InitialDeliveryFee {
  if (input.fulfillmentType !== 'delivery') return { status: 'not_applicable', amount: null };
  const raw = Number(input.deliveryFeeAmount ?? 0);
  const amount = Number.isFinite(raw) && raw > 0 ? Math.round(raw * 100) / 100 : 0;
  if (!input.deliveryZoneId && amount === 0) return { status: 'pending_quote', amount: null };
  return { status: 'paid', amount };
}

export type DeliveryFeeAmountResult = { ok: true; amount: number } | { ok: false; error: string };

/** Montant saisi (nombre ou texte « 12,50 ») : fini, 0 ou plus, plafonné, arrondi au centime. */
export function normalizeDeliveryFeeAmount(value: unknown): DeliveryFeeAmountResult {
  const amount = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim() ? Number(value.trim().replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: 'Indiquez un montant valide (0 ou plus).' };
  if (amount > DELIVERY_FEE_MAX) return { ok: false, error: 'Montant trop élevé.' };
  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

/** Message prêt à envoyer au client (copie ou WhatsApp, toujours à la main). */
export function deliveryFeeMessage(input: {
  customerName: string;
  dateLabel: string;
  amountLabel: string;
  link: string | null;
}): string {
  const firstName = input.customerName.trim().split(/\s+/)[0] ?? '';
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';
  const intro = `${greeting} le supplément de livraison pour votre location du ${input.dateLabel} est de ${input.amountLabel}.`;
  return input.link
    ? `${intro} Vous pouvez le régler ici : ${input.link}`
    : `${intro} Nous vous dirons comment le régler.`;
}
