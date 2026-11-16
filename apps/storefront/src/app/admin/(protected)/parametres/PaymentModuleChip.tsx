import { IconBuildingStore, IconCalendarEvent, IconQrcode, IconTruck, type Icon } from '@tabler/icons-react';
import type { PaymentModule } from '@lepefy/types';

const MODULE_CHIP: Record<PaymentModule, { label: string; icon: Icon }> = {
  shop: { label: 'Boutique', icon: IconBuildingStore },
  card: { label: '/card', icon: IconQrcode },
  event: { label: 'Événements', icon: IconCalendarEvent },
  rental: { label: 'Location', icon: IconTruck },
};

export function paymentModuleIcon(module: PaymentModule): Icon {
  return MODULE_CHIP[module].icon;
}

/** One service a payment method is shown in: icon + name inside its own outlined pill. */
export function PaymentModuleChip({ module }: { module: PaymentModule }) {
  const { label, icon: Glyph } = MODULE_CHIP[module];
  return (
    <span className="inline-flex h-6 items-center gap-1 rounded-md border border-a-border bg-a-surface pl-1.5 pr-2 text-[11px] font-semibold text-a-text-2">
      <Glyph size={13} stroke={1.8} aria-hidden="true" className="text-a-brand-fg" />
      {label}
    </span>
  );
}
