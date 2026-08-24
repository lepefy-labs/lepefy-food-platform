'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconClock,
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCreditCard,
  IconChevronDown,
  IconChevronUp,
} from '@tabler/icons-react';
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
  IconCreditCard,
};

export interface PendingPaymentSession {
  id: string;
  email: string;
  full_name: string | null;
  items: { name: string; price: number; quantity: number }[];
  shipping_total: number;
  ambassador_discount_amount: number | null;
  external_payment_type: string | null;
  external_payment_label: string | null;
  created_at: string;
}

function elapsedLabel(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'à l\'instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

function sessionTotal(session: PendingPaymentSession) {
  return session.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
    + session.shipping_total
    - (session.ambassador_discount_amount ?? 0);
}

export default function PendingPaymentsBanner({
  sessions: initialSessions,
  tenantCurrency,
}: {
  sessions: PendingPaymentSession[];
  tenantCurrency: string;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<PendingPaymentSession[]>([]);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

  // Completed checkout_sessions are now retained for audit/analytics. Never
  // trust the legacy server list (which historically relied on DELETE): refresh
  // from the status-aware endpoint so only live external payments are shown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/checkout-sessions/open', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json() as { sessions?: PendingPaymentSession[] };
        if (!cancelled) setSessions(json.sessions ?? []);
      } catch (error) {
        console.warn('[PendingPaymentsBanner] open sessions refresh failed:', error);
        // Safer to hide than to expose a completed checkout as pending. The
        // server-provided list remains deliberately unused after lifecycle v2.
        if (!cancelled) setSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [initialSessions]);

  const visible = sessions.filter((session) => !confirmedIds.has(session.id));
  const pendingTotal = useMemo(
    () => visible.reduce((sum, session) => sum + sessionTotal(session), 0),
    [visible],
  );

  if (visible.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-amber-900 dark:text-amber-200">
              <IconClock size={15} /> Paiements en attente
            </h2>
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
              {visible.length}
            </span>
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {formatPrice(pendingTotal, tenantCurrency)}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
            Checkouts ouverts non convertis en commandes · aucun stock réservé.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          aria-expanded={expanded}
          className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-gray-900 dark:text-amber-200 dark:hover:bg-amber-950"
        >
          {expanded ? 'Masquer' : `Voir les ${visible.length}`}
          {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-amber-200/80 px-3 py-2.5 dark:border-amber-900">
          <div className="space-y-2">
            {visible.map((session) => {
              const total = sessionTotal(session);
              const methodType = (session.external_payment_type ?? 'other') as PaymentMethodType;
              const meta = PAYMENT_METHOD_REGISTRY[methodType] ?? PAYMENT_METHOD_REGISTRY.other;
              const Icon = PAYMENT_ICONS[meta.iconName];
              const color = methodColor(methodType, '#92400E');
              const itemsSummary = session.items.map((item) => `${item.quantity}× ${item.name}`).join(', ');

              return (
                <div
                  key={session.id}
                  className="flex flex-col gap-2 rounded-lg border border-amber-100 bg-white px-3 py-2 dark:border-amber-900/60 dark:bg-gray-900 sm:flex-row sm:items-center"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: color }}
                  >
                    <Icon size={14} stroke={1.8} className="text-white" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                        {session.external_payment_label ?? meta.label}
                      </span>
                      <span className="text-[11px] text-gray-400">·</span>
                      <span className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {session.full_name ?? session.email}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">{itemsSummary}</p>
                    <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500">{elapsedLabel(session.created_at)}</p>
                  </div>

                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {formatPrice(total, tenantCurrency)}
                    </span>
                    <ConfirmPaymentButton
                      endpoint={`/api/admin/checkout-sessions/${session.id}/confirm-payment`}
                      label="Confirmer réception"
                      confirmingLabel="Confirmation…"
                      className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
                      style={{ backgroundColor: '#D97706' }}
                      onSuccess={(warning) => {
                        if (!warning) setConfirmedIds((prev) => new Set(prev).add(session.id));
                        router.refresh();
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
