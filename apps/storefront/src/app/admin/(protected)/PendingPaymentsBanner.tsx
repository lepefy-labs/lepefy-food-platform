'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconClock, IconBuildingBank, IconCash, IconBrandPaypal, IconQrcode, IconWallet } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { methodColor } from '@/lib/card/methodColor';
import ConfirmPaymentButton from '../_components/ui/ConfirmPaymentButton';
import { PAYMENT_METHOD_REGISTRY, type PaymentMethodType } from '@lepefy/types';

const PAYMENT_ICONS = {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
};

export interface PendingPaymentSession {
  id:                      string;
  email:                   string;
  full_name:               string | null;
  items:                   { name: string; price: number; quantity: number }[];
  shipping_total:          number;
  ambassador_discount_amount: number | null;
  external_payment_type:   string | null;
  external_payment_label:  string | null;
  created_at:              string;
}

function elapsedLabel(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1)  return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

export default function PendingPaymentsBanner({
  sessions,
  tenantCurrency,
}: {
  sessions:       PendingPaymentSession[];
  tenantCurrency: string;
}) {
  const router = useRouter();
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  const visible = sessions.filter((s) => !confirmedIds.has(s.id));
  if (visible.length === 0) return null;

  return (
    <section className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-2xl p-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
          <IconClock size={16} /> Paiements en attente ({visible.length})
        </h2>
      </div>
      <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
        Ces demandes ne sont pas encore des commandes — aucun stock n&apos;est réservé.
      </p>

      <div className="space-y-2">
        {visible.map((session) => {
          const total = session.items.reduce((s, i) => s + i.price * i.quantity, 0)
            + session.shipping_total - (session.ambassador_discount_amount ?? 0);
          const methodType = (session.external_payment_type ?? 'other') as PaymentMethodType;
          const meta  = PAYMENT_METHOD_REGISTRY[methodType] ?? PAYMENT_METHOD_REGISTRY.other;
          const Icon  = PAYMENT_ICONS[meta.iconName];
          const color = methodColor(methodType, '#92400E');
          const itemsSummary = session.items.map((i) => `${i.quantity}× ${i.name}`).join(', ');

          return (
            <div
              key={session.id}
              className="bg-white dark:bg-gray-900 rounded-xl border border-amber-100 dark:border-amber-900/60 p-3 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <span
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: color }}
              >
                <Icon size={16} stroke={1.8} className="text-white" />
              </span>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {session.external_payment_label ?? meta.label}
                  </span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {session.full_name ?? session.email}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{itemsSummary}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{elapsedLabel(session.created_at)}</p>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {formatPrice(total, tenantCurrency)}
                </span>
                <ConfirmPaymentButton
                  mode="external_link"
                  id={session.id}
                  label="Confirmer réception"
                  confirmingLabel="Confirmation…"
                  className="py-2 px-3 rounded-lg font-semibold text-white text-xs whitespace-nowrap transition-opacity disabled:opacity-50"
                  style={{ backgroundColor: '#D97706' }}
                  onSuccess={(warning) => {
                    if (!warning) {
                      setConfirmedIds((prev) => new Set(prev).add(session.id));
                    }
                    router.refresh();
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
