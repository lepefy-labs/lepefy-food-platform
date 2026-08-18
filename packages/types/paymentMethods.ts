// Modules de paiement de la plateforme — définition unique, importée par
// lib/payments/stripeServerConfig.ts et stripeClientConfig.ts (Phase A) et
// par le scoping enabled_modules ci-dessous (Phase B), pour éviter que deux
// unions divergent si un cinquième module est ajouté un jour.
export type PaymentModule = 'shop' | 'card' | 'event' | 'rental';

export type PaymentMethodType =
  | 'satispay'
  | 'bank_transfer'
  | 'cash'
  | 'paypal'
  | 'other'
  | 'card';

export interface PaymentMethodMeta {
  label: string;
  iconName:
    | 'IconQrcode'
    | 'IconBuildingBank'
    | 'IconCash'
    | 'IconBrandPaypal'
    | 'IconWallet'
    | 'IconCreditCard';
}

// Registro condiviso a livello di piattaforma — stesso pattern di
// SOCIAL_PLATFORM_REGISTRY. Aggiungere un metodo = aggiungere una riga qui +
// estendere la CHECK constraint SQL. Nessun valore tenant-specific qui dentro.
export const PAYMENT_METHOD_REGISTRY: Record<PaymentMethodType, PaymentMethodMeta> = {
  satispay:      { label: 'Satispay',            iconName: 'IconQrcode' },
  bank_transfer: { label: 'Virement bancaire',   iconName: 'IconBuildingBank' },
  cash:          { label: 'Espèces',             iconName: 'IconCash' },
  paypal:        { label: 'PayPal',              iconName: 'IconBrandPaypal' },
  other:         { label: 'Autre',               iconName: 'IconWallet' },
  card:          { label: 'Carte bancaire',      iconName: 'IconCreditCard' },
};

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
