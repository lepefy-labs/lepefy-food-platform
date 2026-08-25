'use client';

import { useEffect, useRef, useState } from 'react';
import { IconEye, IconMail, IconMapPin, IconPhone, IconTruck, IconUser, IconWallet, IconX } from '@tabler/icons-react';

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [open]);

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
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-4 text-sm font-semibold text-gray-700 shadow-sm transition-colors hover:bg-[var(--admin-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      >
        <IconEye size={18} /> Voir le détail de l’achat
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-5"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-detail-title"
            className="max-h-[92vh] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-900 sm:max-w-3xl sm:rounded-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--admin-border)] px-5 py-4 dark:border-gray-800 sm:px-6">
              <div>
                <h2 id="payment-detail-title" className="text-lg font-bold text-gray-950 dark:text-white">Détail de l’achat</h2>
                <p className="mt-1 text-sm text-gray-500">{payment.reference} · {payment.method}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] dark:hover:bg-gray-800"
              >
                <IconX size={20} />
              </button>
            </div>

            <div className="max-h-[calc(92vh-76px)] overflow-y-auto p-5 sm:p-6">
              <div className="grid gap-4 md:grid-cols-2">
                <section className="rounded-2xl border border-[var(--admin-border)] p-4 dark:border-gray-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconUser size={16} /> Client</div>
                  <p className="mt-3 font-bold text-gray-950 dark:text-white">{customer.name}</p>
                  <a href={`mailto:${customer.email}`} className="mt-2 flex min-h-8 items-center gap-2 break-all text-sm text-[var(--admin-primary-fg)] hover:underline">
                    <IconMail size={16} className="shrink-0" /> {customer.email}
                  </a>
                  {customer.phone ? (
                    <a href={`tel:${customer.phone}`} className="mt-1 flex min-h-8 items-center gap-2 text-sm text-[var(--admin-primary-fg)] hover:underline">
                      <IconPhone size={16} className="shrink-0" /> {customer.phone}
                    </a>
                  ) : (
                    <p className="mt-1 text-sm text-gray-400">Téléphone non renseigné</p>
                  )}
                </section>

                <section className="rounded-2xl border border-[var(--admin-border)] p-4 dark:border-gray-800">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500"><IconTruck size={16} /> Remise</div>
                  <p className="mt-3 font-bold text-gray-950 dark:text-white">{fulfillmentType === 'pickup' ? 'Click & Collect' : 'Livraison'}</p>
                  {fulfillmentType === 'delivery' ? (
                    addressLines.length > 0 ? (
                      <div className="mt-2 flex items-start gap-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
                        <IconMapPin size={17} className="mt-1 shrink-0" />
                        <div>{addressLines.map((line, index) => <div key={`${line}-${index}`}>{line}</div>)}</div>
                      </div>
                    ) : <p className="mt-2 text-sm text-gray-400">Adresse non renseignée</p>
                  ) : (
                    <p className="mt-2 text-sm text-gray-500">Retrait prévu en boutique.</p>
                  )}
                </section>
              </div>

              <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--admin-border)] dark:border-gray-800">
                <div className="flex items-center gap-2 border-b border-[var(--admin-border)] bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-950/50">
                  <IconWallet size={16} /> Articles et total
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((item, index) => (
                    <div key={`${item.name}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{item.name}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{item.quantity} × {formatMoney(item.price, currency)}</p>
                      </div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{formatMoney(item.price * item.quantity, currency)}</p>
                    </div>
                  ))}
                </div>
                <div className="space-y-2 border-t border-[var(--admin-border)] bg-gray-50 px-4 py-4 text-sm dark:border-gray-800 dark:bg-gray-950/50">
                  <div className="flex justify-between gap-4"><span className="text-gray-500">Sous-total</span><span>{formatMoney(subtotal, currency)}</span></div>
                  <div className="flex justify-between gap-4"><span className="text-gray-500">Livraison</span><span>{formatMoney(shippingTotal, currency)}</span></div>
                  {discountTotal > 0 && <div className="flex justify-between gap-4"><span className="text-gray-500">Réduction</span><span>− {formatMoney(discountTotal, currency)}</span></div>}
                  <div className="flex justify-between gap-4 border-t border-gray-200 pt-3 text-base font-bold dark:border-gray-700"><span>Total</span><span>{formatMoney(total, currency)}</span></div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
