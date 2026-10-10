'use client';

import { useState } from 'react';
import Dialog from '@/app/admin/_components/ui/Dialog';
import { IconEye, IconMail, IconMapPin, IconPhone, IconTruck, IconUser, IconWallet } from '@tabler/icons-react';

interface Item {
  name: string;
  price: number;
  quantity: number;
}

interface Address {
  full_name?: string | null;
  line1?: string | null;
  line2?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
}

interface Props {
  customer: {
    name: string;
    email: string;
    phone: string | null;
  };
  payment: {
    reference: string;
    method: string;
  };
  fulfillmentType: 'delivery' | 'pickup';
  shippingAddress: Address | null;
  items: Item[];
  subtotal: number;
  shippingTotal: number;
  discountTotal: number;
  total: number;
  currency: string;
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(value);
}

export default function PaymentRecoveryDetails({
  customer,
  payment,
  fulfillmentType,
  shippingAddress,
  items,
  subtotal,
  shippingTotal,
  discountTotal,
  total,
  currency,
}: Props) {
  const [open, setOpen] = useState(false);


  const addressLines = shippingAddress
    ? [
        shippingAddress.full_name,
        shippingAddress.line1,
        shippingAddress.line2,
        [shippingAddress.postal_code, shippingAddress.city].filter(Boolean).join(' '),
        shippingAddress.country,
      ].filter(Boolean)
    : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-a-border bg-a-surface px-4 text-sm font-semibold text-a-text-2 shadow-sm transition-colors hover:bg-a-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-a-focus"
      >
        <IconEye size={18} /> Voir le détail de l’achat
      </button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="xl"
        title="Détail de l’achat"
        description={`${payment.reference} · ${payment.method}`}
      >
            <div>
              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-2xl border border-a-border p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconUser size={16} /> Client</div>
                  <p className="mt-3 font-bold text-a-text">{customer.name}</p>
                  <a href={`mailto:${customer.email}`} className="mt-2 flex min-h-8 items-center gap-2 break-all text-sm text-a-brand-fg hover:underline">
                    <IconMail size={16} className="shrink-0" /> {customer.email}
                  </a>
                  {customer.phone ? (
                    <a href={`tel:${customer.phone}`} className="mt-1 flex min-h-8 items-center gap-2 text-sm text-a-brand-fg hover:underline">
                      <IconPhone size={16} className="shrink-0" /> {customer.phone}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-a-text-3">Téléphone non renseigné</p>
                  )}
                </section>

                <section className="rounded-2xl border border-a-border p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-a-text-3"><IconTruck size={16} /> Remise</div>
                  <p className="mt-3 font-bold text-a-text">{fulfillmentType === 'pickup' ? 'Click & Collect' : 'Livraison'}</p>
                  {fulfillmentType === 'delivery' ? (
                    addressLines.length > 0 ? (
                      <div className="mt-2 flex items-start gap-2 text-sm leading-6 text-a-text-2">
                        <IconMapPin size={17} className="mt-1 shrink-0" />
                        <div>{addressLines.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
                      </div>
                    ) : <p className="mt-2 text-sm text-a-text-3">Adresse non renseignée</p>
                  ) : (
                    <p className="mt-2 text-sm text-a-text-3">Retrait prévu en boutique.</p>
                  )}
                </section>
              </div>

              <section className="mt-4 overflow-hidden rounded-2xl border border-a-border">
                <div className="flex items-center gap-2 border-b border-a-border bg-a-surface-2 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-a-text-3">
                  <IconWallet size={16} /> Articles et total
                </div>
                <div className="divide-y divide-a-border">
                  {items.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-a-text">{item.name}</p>
                        <p className="mt-0.5 text-xs text-a-text-3">{item.quantity} × {formatMoney(item.price, currency)}</p>
                      </div>
                      <p className="font-semibold text-a-text">{formatMoney(item.price * item.quantity, currency)}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t border-a-border bg-a-surface-2 px-4 py-4 text-sm">
                  <div className="flex justify-between gap-4"><span className="text-a-text-3">Sous-total</span><span>{formatMoney(subtotal, currency)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-a-text-3">Livraison</span><span>{formatMoney(shippingTotal, currency)}</span></div>
                  {discountTotal > 0 && <div className="flex justify-between gap-4"><span className="text-a-text-3">Réduction</span><span>− {formatMoney(discountTotal, currency)}</span></div>}
                  <div className="flex justify-between gap-4 border-t border-a-border pt-3 text-base font-bold"><span>Total</span><span>{formatMoney(total, currency)}</span></div>
                </div>
              </section>
            </div>
      </Dialog>
    </>
  );
}
