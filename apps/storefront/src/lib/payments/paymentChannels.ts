import { PAYMENT_MODULE_KEYS, type PaymentModule, type TenantPaymentMethod } from '@lepefy/types';
import { isLinkPaymentMethod } from './externalPaymentLink';

/**
 * Single rule for « which configured payment method may a customer use here »,
 * read by the customer pages that list methods AND by the routes that accept
 * a chosen method id, so a method can never be paid with where the shop did
 * not offer it. The admin page (paymentMethodAvailability.ts) explains the same
 * rule. Pure, client-safe, relative imports only.
 *
 * Channels:
 * - shop_checkout: storefront checkout, pending-payment page, session resume.
 * - shop_pay_link: payment page of an assisted order (/pay/[token]).
 * - card: the /card landing.
 * - event, rental: reservation payments.
 */
export type PaymentChannel = 'shop_checkout' | 'shop_pay_link' | 'card' | 'event' | 'rental';

export const CHANNEL_MODULE: Record<PaymentChannel, PaymentModule> = {
  shop_checkout: 'shop',
  shop_pay_link: 'shop',
  card: 'card',
  event: 'event',
  rental: 'rental',
};

type MethodShape = Pick<TenantPaymentMethod, 'method' | 'value' | 'extra'>;

/** What the channel can display for this method, ignoring active/enabled_modules. */
export function channelSupports(m: MethodShape, channel: PaymentChannel): boolean {
  switch (channel) {
    case 'shop_checkout':
    case 'event':
    case 'rental':
      // External payment link only (no transfer, no cash; card / Apple Pay never store a link).
      return isLinkPaymentMethod(m);
    case 'shop_pay_link':
      // Card and Apple Pay go through Stripe; cash makes no sense remotely.
      if (m.method === 'card' || m.method === 'apple_pay' || m.method === 'cash') return false;
      if (m.method === 'bank_transfer') return Boolean(m.value?.trim());
      return Boolean(m.extra?.link?.trim() || m.value?.trim());
    case 'card':
      // Cash is never offered from /card (Apple Pay visibility is decided by the device: applePay.ts).
      return m.method !== 'cash';
  }
}

/** Active, enabled for the channel's module and displayable there. */
export function isOfferedIn(m: MethodShape & Pick<TenantPaymentMethod, 'active' | 'enabled_modules'>, channel: PaymentChannel): boolean {
  // A row read before migration 066 has no enabled_modules: same as the column default (every module).
  return m.active && (m.enabled_modules ?? PAYMENT_MODULE_KEYS).includes(CHANNEL_MODULE[channel]) && channelSupports(m, channel);
}

/** The methods a customer is offered in a channel, display order kept. */
export function methodsOfferedIn<T extends MethodShape & Pick<TenantPaymentMethod, 'active' | 'enabled_modules'>>(
  methods: ReadonlyArray<T>,
  channel: PaymentChannel,
): T[] {
  return methods.filter((m) => isOfferedIn(m, channel));
}
