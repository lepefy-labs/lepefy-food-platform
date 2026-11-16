import type { PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import { channelSupports } from './paymentChannels';

/**
 * Admin reading of the channel rule (paymentChannels.ts): whether a configured
 * payment method can show in each service with its current settings, and why
 * not, so the admin never ticks a box that does nothing. `ok` comes only from
 * `channelSupports`; this file only adds the explanations. Client-safe.
 */

type MethodLike = Pick<TenantPaymentMethod, 'method' | 'value' | 'extra'>;

export interface ServiceAvailability {
  /** The method is shown in this service when it is enabled there. */
  ok: boolean;
  /** Why it can't be shown (ok = false), or where/how it is shown (ok = true). */
  detail: string;
}

const hasLink = (m: MethodLike) => Boolean(m.extra?.link?.trim());
const hasValue = (m: MethodLike) => Boolean(m.value?.trim());

function okDetail(m: MethodLike, service: PaymentModule): string {
  if (service === 'card') {
    if (m.method === 'apple_pay') return 'Affiché sur les appareils compatibles, une fois le domaine validé par Stripe.';
    if (m.method === 'card') return 'Paiement par carte, montant saisi par le client.';
    if (m.method === 'bank_transfer') return hasValue(m) ? 'IBAN affiché avec un bouton Copier.' : 'Tuile affichée, mais sans IBAN : renseignez-le.';
    return hasLink(m) || hasValue(m) ? 'Tuile avec le lien ou l’identifiant.' : 'Tuile affichée, mais sans lien ni identifiant : renseignez-en un.';
  }
  if (service === 'shop') {
    if (channelSupports(m, 'shop_checkout')) return 'Checkout en ligne et liens de paiement envoyés aux clients.';
    if (m.method === 'bank_transfer') return 'Uniquement dans les liens de paiement envoyés aux clients (WhatsApp, téléphone…), pas au checkout.';
    return 'Uniquement dans les liens de paiement envoyés aux clients : ajoutez un lien pour le checkout.';
  }
  return 'Proposé au paiement de la réservation.';
}

function noDetail(m: MethodLike, service: PaymentModule): string {
  if (m.method === 'cash') return service === 'card' ? 'Les espèces ne sont jamais proposées sur /card.' : 'Aucun parcours en ligne ne propose les espèces.';
  if (m.method === 'card' || m.method === 'apple_pay') {
    return service === 'shop'
      ? 'Le paiement par carte de la boutique passe par Stripe (Paramètres › Intégrations), pas par ce moyen.'
      : 'Ce moyen n’existe que sur la page /card.';
  }
  if (m.method === 'bank_transfer') {
    return service === 'shop' ? 'Renseignez l’IBAN pour le proposer dans les liens de paiement.' : 'Le virement n’est pas proposé pour les réservations.';
  }
  return service === 'shop' ? 'Ajoutez un lien de paiement pour le proposer.' : 'Ajoutez un lien de paiement pour le proposer ici.';
}

export function paymentMethodAvailability(m: MethodLike, service: PaymentModule): ServiceAvailability {
  const ok = service === 'shop'
    ? channelSupports(m, 'shop_checkout') || channelSupports(m, 'shop_pay_link')
    : channelSupports(m, service);
  return { ok, detail: ok ? okDetail(m, service) : noDetail(m, service) };
}

/** Enabled services where the method really shows. */
export function effectiveModules(m: MethodLike & Pick<TenantPaymentMethod, 'enabled_modules'>): PaymentModule[] {
  return m.enabled_modules.filter((service) => paymentMethodAvailability(m, service).ok);
}

/** Active, but no customer path can show it with its current settings. */
export function isVisibleNowhere(m: MethodLike & Pick<TenantPaymentMethod, 'enabled_modules' | 'active'>): boolean {
  return m.active && effectiveModules(m).length === 0;
}

/** What the customer sees in one service, in display order, and what is ticked but ignored. */
export function customerView<T extends MethodLike & Pick<TenantPaymentMethod, 'enabled_modules' | 'active'>>(
  methods: ReadonlyArray<T>,
  service: PaymentModule,
): { shown: T[]; ignored: Array<{ method: T; reason: string }> } {
  const shown: T[] = [];
  const ignored: Array<{ method: T; reason: string }> = [];
  for (const m of methods) {
    if (!m.active || !m.enabled_modules.includes(service)) continue;
    const availability = paymentMethodAvailability(m, service);
    if (availability.ok) shown.push(m);
    else ignored.push({ method: m, reason: availability.detail });
  }
  return { shown, ignored };
}
