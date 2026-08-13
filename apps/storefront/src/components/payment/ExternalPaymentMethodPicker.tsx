import type { ReactNode } from 'react';
import { IconBuildingBank, IconCash, IconBrandPaypal, IconQrcode, IconWallet, IconCreditCard } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { methodColor } from '@/lib/card/methodColor';
import { PAYMENT_METHOD_REGISTRY, type TenantPaymentMethod } from '@lepefy/types';

// Composant partagé entre le checkout boutique ((shop)/checkout/CheckoutForm.tsx)
// et le checkout billetterie événementiel (EventCheckoutClient.tsx) — extrait
// en Phase 2 pour ne pas dupliquer le pattern "liste de cartes radio + note
// dynamique + CTA colorée" introduit en Phase 1. Même registre d'icônes que
// DigitalCard/PosterTemplate (PAYMENT_METHOD_REGISTRY), jamais un jeu d'icônes
// différent pour la même donnée tenant_payment_methods.

const PAYMENT_ICONS = {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCreditCard,
};

export interface PaymentOption {
  key:      string;
  selected: boolean;
  onSelect: () => void;
  icon:     ReactNode;
  color:    string;
  label:    string;
  sub:      string;
}

function PaymentOptionCard({ option }: { option: PaymentOption }) {
  return (
    <button
      type="button"
      onClick={option.onSelect}
      className={`w-full flex items-center gap-3 py-3 px-3.5 rounded-xl border text-sm font-medium text-left transition-all ${
        option.selected
          ? 'border-[var(--color-primary)] bg-[var(--color-primary-light,#f0fdf4)]'
          : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: option.color }}
      >
        {option.icon}
      </span>
      <span className="flex-1">
        <span className="block text-gray-800">{option.label}</span>
        <span className="block text-xs text-gray-400 font-normal">{option.sub}</span>
      </span>
      <span className={`w-[18px] h-[18px] rounded-full border-2 flex-shrink-0 ${
        option.selected ? 'border-[var(--color-primary)] bg-[var(--color-primary)] bg-clip-padding' : 'border-gray-300'
      }`} />
    </button>
  );
}

export function PaymentOptionList({ options }: { options: PaymentOption[] }) {
  return (
    <div className="space-y-2">
      {options.map((option) => <PaymentOptionCard key={option.key} option={option} />)}
    </div>
  );
}

// Une entrée par ligne tenant_payment_methods éligible (type != bank_transfer/
// cash, extra.link renseigné) — jamais codé en dur par tenant.
export function buildExternalPaymentOptions(
  methods:      TenantPaymentMethod[],
  selectedId:   string | null,
  onSelect:     (id: string) => void,
): PaymentOption[] {
  return methods.map((pm) => {
    const meta = PAYMENT_METHOD_REGISTRY[pm.method];
    const Icon = PAYMENT_ICONS[meta.iconName];
    return {
      key:      pm.id,
      selected: selectedId === pm.id,
      onSelect: () => onSelect(pm.id),
      icon:     <Icon size={16} stroke={1.8} className="text-white" />,
      color:    methodColor(pm.method, 'var(--color-primary)'),
      label:    pm.label ?? meta.label,
      sub:      pm.method === 'paypal' ? 'Lien direct · montant pré-rempli' : 'Lien direct · montant à saisir',
    };
  });
}

// Note dynamique — affichée uniquement une fois le moyen choisi (jamais avant).
export function ExternalPaymentNote({
  method,
  total,
  currency,
}: {
  method:   TenantPaymentMethod;
  total:    number;
  currency: string;
}) {
  return (
    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5 mt-3 leading-relaxed">
      {method.method === 'paypal'
        ? <>Sélectionnez « Amis et famille » lors du paiement pour éviter les frais. Le montant ({formatPrice(total, currency)}) sera pré-rempli dans le lien.</>
        : <>Le montant n&apos;est pas prérempli sur ce lien — saisissez-le manuellement : <strong>{formatPrice(total, currency)}</strong>.</>
      }
    </p>
  );
}

// `noun` distingue "la commande" (boutique) de "la réservation" (billetterie
// événementiel) — même gabarit de texte, seul le nom change selon le module.
export function externalPaymentCtaLabel(method: TenantPaymentMethod, noun: string = 'la commande'): string {
  return `Créer ${noun} et ouvrir ${method.label ?? PAYMENT_METHOD_REGISTRY[method.method].label}`;
}

export function externalPaymentCtaColor(method: TenantPaymentMethod): string {
  return methodColor(method.method, 'var(--color-primary)');
}
