// Modules de paiement de la plateforme — définition unique, importée par
// lib/payments/stripeServerConfig.ts et stripeClientConfig.ts (Phase A) et
// par le scoping enabled_modules ci-dessous (Phase B), pour éviter que deux
// unions divergent si un cinquième module est ajouté un jour.
export type PaymentModule = 'shop' | 'card' | 'event' | 'rental';

/** Every module, in display order. Also the DB default of `enabled_modules` (migration 066). */
export const PAYMENT_MODULE_KEYS: readonly PaymentModule[] = ['shop', 'card', 'event', 'rental'];

export type PaymentMethodType =
  | 'satispay'
  | 'bank_transfer'
  | 'cash'
  | 'paypal'
  | 'other'
  | 'card'
  | 'apple_pay';

export interface PaymentMethodMeta {
  label: string;
  iconName:
    | 'IconQrcode'
    | 'IconBuildingBank'
    | 'IconCash'
    | 'IconBrandPaypal'
    | 'IconWallet'
    | 'IconCreditCard'
    | 'IconBrandApple';
  /**
   * false: nothing to store besides the name (`value` and `extra` are always
   * null — card and Apple Pay are an on/off of the /card buttons, cash is paid
   * in person).
   */
  storesDetails: boolean;
  /** At most one row per tenant (a second one would duplicate the same /card button). */
  singleInstance: boolean;
  /** Modules ticked when the method is created without an explicit choice. */
  defaultModules: readonly PaymentModule[];
}

// Registro condiviso a livello di piattaforma — stesso pattern di
// SOCIAL_PLATFORM_REGISTRY. Aggiungere un metodo = aggiungere una riga qui +
// estendere la CHECK constraint SQL + le sue regole di canale in
// apps/storefront/src/lib/payments/paymentChannels.ts. Nessun valore
// tenant-specific qui dentro.
export const PAYMENT_METHOD_REGISTRY: Record<PaymentMethodType, PaymentMethodMeta> = {
  satispay:      { label: 'Satispay',          iconName: 'IconQrcode',       storesDetails: true,  singleInstance: false, defaultModules: PAYMENT_MODULE_KEYS },
  bank_transfer: { label: 'Virement bancaire', iconName: 'IconBuildingBank', storesDetails: true,  singleInstance: false, defaultModules: PAYMENT_MODULE_KEYS },
  cash:          { label: 'Espèces',           iconName: 'IconCash',         storesDetails: false, singleInstance: false, defaultModules: PAYMENT_MODULE_KEYS },
  paypal:        { label: 'PayPal',            iconName: 'IconBrandPaypal',  storesDetails: true,  singleInstance: false, defaultModules: PAYMENT_MODULE_KEYS },
  other:         { label: 'Autre',             iconName: 'IconWallet',       storesDetails: true,  singleInstance: false, defaultModules: PAYMENT_MODULE_KEYS },
  card:          { label: 'Carte bancaire',    iconName: 'IconCreditCard',   storesDetails: false, singleInstance: true,  defaultModules: PAYMENT_MODULE_KEYS },
  // Apple Pay n'existe que dans /card.
  apple_pay:     { label: 'Apple Pay',         iconName: 'IconBrandApple',   storesDetails: false, singleInstance: true,  defaultModules: ['card'] },
};

/** Every type, in the order of the admin type picker. */
export const PAYMENT_METHOD_TYPE_KEYS: readonly PaymentMethodType[] = ['card', 'apple_pay', 'paypal', 'satispay', 'bank_transfer', 'cash', 'other'];

export function isPaymentMethodType(value: unknown): value is PaymentMethodType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PAYMENT_METHOD_REGISTRY, value);
}

export function isPaymentModule(value: unknown): value is PaymentModule {
  return typeof value === 'string' && (PAYMENT_MODULE_KEYS as readonly string[]).includes(value);
}

export interface TenantPaymentMethod {
  id: string;
  tenant_id: string;
  method: PaymentMethodType;
  label: string | null;
  value: string | null;
  extra: { beneficiary?: string; bic?: string; link?: string } | null;
  sort_order: number;
  active: boolean;
  enabled_modules: PaymentModule[];
}
