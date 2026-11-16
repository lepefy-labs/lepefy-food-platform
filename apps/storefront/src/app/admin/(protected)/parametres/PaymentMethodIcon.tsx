import {
  IconBrandApple,
  IconBrandPaypal,
  IconBuildingBank,
  IconCash,
  IconCreditCard,
  IconQrcode,
  IconWallet,
  type Icon,
} from '@tabler/icons-react';
import type { PaymentMethodType } from '@lepefy/types';
import { cn } from '@/lib/utils/cn';

// Same icons as PAYMENT_METHOD_REGISTRY.iconName.
const ICONS: Record<PaymentMethodType, Icon> = {
  card: IconCreditCard,
  apple_pay: IconBrandApple,
  paypal: IconBrandPaypal,
  satispay: IconQrcode,
  bank_transfer: IconBuildingBank,
  cash: IconCash,
  other: IconWallet,
};

export function PaymentMethodIcon({ method, size = 'md', className }: { method: PaymentMethodType; size?: 'sm' | 'md'; className?: string }) {
  const Glyph = ICONS[method] ?? IconWallet;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center bg-a-brand-soft text-a-brand-fg',
        size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl',
        className,
      )}
    >
      <Glyph size={size === 'sm' ? 16 : 20} stroke={1.7} />
    </span>
  );
}
