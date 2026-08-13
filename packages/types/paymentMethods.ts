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
}
