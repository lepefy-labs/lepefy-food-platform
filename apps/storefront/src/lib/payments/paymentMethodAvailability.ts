import type { PaymentModule, TenantPaymentMethod } from '@lepefy/types';
import { isLinkPaymentMethod } from './externalPaymentLink';

/**
 * Where a configured payment method can actually reach the customer, per
 * service, so the admin never ticks a box that does nothing. Mirrors the
 * filters of the customer paths (parity-tested in
 * tests/unit/paymentMethodAvailability.spec.ts):
 * - Boutique: storefront checkout = `isLinkPaymentMethod`; payment links of
 *   assisted orders = `publicExternalMethods` (lib/orders/assisted/payLinkPublic.ts).
 * - /card: `cardLandingMethods` (every type but cash).
 * - Événements, Location: `isLinkPaymentMethod`.
 * Client-safe: no server import.
 */

type MethodLike = Pick<TenantPaymentMethod, 'method' | 'value' | 'extra'>;

export interface ServiceAvailability {
  /** The method is shown in this service when it is enabled there. */
  ok: boolean;
  /** Why it can't be shown (ok = false), or where/how it is shown (ok = true). */
  detail: string;
}

const LINK_TYPES = new Set(['paypal', 'satispay', 'other']);

const hasLink = (m: MethodLike) => Boolean(m.extra?.link?.trim());
const hasValue = (m: MethodLike) => Boolean(m.value?.trim());

export function paymentMethodAvailability(m: MethodLike, service: PaymentModule): ServiceAvailability {
  if (service === 'card') {
    if (m.method === 'cash') return { ok: false, detail: 'Les espèces ne sont jamais proposées sur /card.' };
    if (m.method === 'apple_pay') return { ok: true, detail: 'Affiché sur les appareils compatibles, une fois le domaine validé par Stripe.' };
    if (m.method === 'card') return { ok: true, detail: 'Paiement par carte, montant saisi par le client.' };
    if (m.method === 'bank_transfer') return { ok: true, detail: hasValue(m) ? 'IBAN affiché avec un bouton Copier.' : 'Tuile affichée, mais sans IBAN : renseignez-le.' };
    return { ok: true, detail: hasLink(m) || hasValue(m) ? 'Tuile avec le lien ou l’identifiant.' : 'Tuile affichée, mais sans lien ni identifiant : renseignez-en un.' };
  }

  if (m.method === 'card' || m.method === 'apple_pay') {
    return {
      ok: false,
      detail: service === 'shop'
        ? 'Le paiement par carte de la boutique passe par Stripe (Paramètres › Intégrations), pas par ce moyen.'
        : 'Ce moyen n’existe que sur la page /card.',
    };
  }
  if (m.method === 'cash') return { ok: false, detail: 'Aucun parcours en ligne ne propose les espèces.' };

  if (service === 'shop') {
    if (m.method === 'bank_transfer') {
      return hasValue(m)
        ? { ok: true, detail: 'Uniquement dans les liens de paiement envoyés aux clients (WhatsApp, téléphone…), pas au checkout.' }
        : { ok: false, detail: 'Renseignez l’IBAN pour le proposer dans les liens de paiement.' };
    }
    if (isLinkPaymentMethod(m)) return { ok: true, detail: 'Checkout en ligne et liens de paiement envoyés aux clients.' };
    if (hasValue(m)) return { ok: true, detail: 'Uniquement dans les liens de paiement envoyés aux clients : ajoutez un lien pour le checkout.' };
    return { ok: false, detail: 'Ajoutez un lien de paiement pour le proposer.' };
  }

  // event, rental
  if (m.method === 'bank_transfer') return { ok: false, detail: 'Le virement n’est pas proposé pour les réservations.' };
  if (LINK_TYPES.has(m.method) && isLinkPaymentMethod(m)) return { ok: true, detail: 'Proposé au paiement de la réservation.' };
  return { ok: false, detail: 'Ajoutez un lien de paiement pour le proposer ici.' };
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
