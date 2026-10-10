'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertTriangle,
  IconClock,
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCreditCard,
  IconBrandApple,
  IconChevronDown,
  IconChevronUp,
  IconSettings,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { methodColor } from '@/lib/card/methodColor';
import ConfirmPaymentButton from '../_components/ui/ConfirmPaymentButton';
import Badge from '../_components/ui/Badge';
import Button, { ButtonLink, buttonClasses } from '../_components/ui/Button';
import { PAYMENT_METHOD_REGISTRY, type PaymentMethodType } from '@lepefy/types';

const PAYMENT_ICONS = {
  IconBuildingBank,
  IconCash,
  IconBrandPaypal,
  IconQrcode,
  IconWallet,
  IconCreditCard,
  IconBrandApple,
};

const AGED_PAYMENT_MS = 24 * 60 * 60 * 1000;

export interface PendingPaymentSession {
  id: string;
  email: string | null;
  full_name: string | null;
  items: { name: string; price: number; quantity: number }[];
  shipping_total: number;
  ambassador_discount_amount: number | null;
  external_payment_type: string | null;
  external_payment_label: string | null;
  created_at: string;
  status?: 'open' | 'expired' | 'awaiting_verification';
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

function isAgedPayment(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() >= AGED_PAYMENT_MS;
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
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);

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
        if (!cancelled) setSessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [initialSessions]);

  const visible = useMemo(
    () => sessions
      .filter((session) => !resolvedIds.has(session.id))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [resolvedIds, sessions],
  );
  const pendingTotal = useMemo(
    () => visible.reduce((sum, session) => sum + sessionTotal(session), 0),
    [visible],
  );
  const agedCount = useMemo(
    () => visible.filter((session) => isAgedPayment(session.created_at)).length,
    [visible],
  );

  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="pending-payments-title" className="overflow-hidden rounded-[10px] border border-tone-warning-border bg-tone-warning-bg">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-tone-warning-fg">
          <h2 id="pending-payments-title" className="flex items-center gap-1.5 text-sm font-semibold">
            <IconClock size={16} aria-hidden="true" /> Paiements à vérifier
          </h2>
          <span className="text-sm tabular-nums">{visible.length} · {formatPrice(pendingTotal, tenantCurrency)}</span>
          {agedCount > 0 && <Badge tone="danger" icon={<IconAlertTriangle size={12} aria-hidden="true" />}>{agedCount} depuis +24 h</Badge>}
          <Link href="/admin/checkout-funnel" className="text-xs font-semibold underline underline-offset-2">Voir le funnel</Link>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="shrink-0">
          {expanded ? 'Masquer' : 'Détails'}
          {expanded ? <IconChevronUp size={14} aria-hidden="true" /> : <IconChevronDown size={14} aria-hidden="true" />}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-tone-warning-border bg-a-surface px-3 py-2.5">
          <p className="mb-2 text-xs text-a-text-2">
            Paiements externes à vérifier manuellement · aucun stock réservé · les plus anciens sont affichés en premier.
          </p>
          <ul className="space-y-2">
            {visible.map((session) => {
              const total = sessionTotal(session);
              const methodType = (session.external_payment_type ?? 'other') as PaymentMethodType;
              const meta = PAYMENT_METHOD_REGISTRY[methodType] ?? PAYMENT_METHOD_REGISTRY.other;
              const Icon = PAYMENT_ICONS[meta.iconName];
              // Payment method identity colour (like a brand logo), not a state.
              const color = methodColor(methodType, '#92400E');
              const itemsSummary = session.items.map((item) => `${item.quantity}× ${item.name}`).join(', ');
              const aged = isAgedPayment(session.created_at);

              return (
                <li key={session.id} className={`relative flex flex-col gap-2 overflow-hidden rounded-lg border bg-a-surface px-3 py-2 sm:flex-row sm:items-center ${aged ? 'border-tone-danger-border' : 'border-a-border'}`}>
                  {aged && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-tone-danger-solid" />}
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: color }}>
                    <Icon size={15} stroke={1.8} aria-hidden="true" className="text-white" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-semibold text-a-text">{session.external_payment_label ?? meta.label}</span>
                      <span aria-hidden="true" className="text-a-text-3">·</span>
                      <span className="truncate text-a-text-2">{session.full_name ?? session.email ?? 'Client'}</span>
                      {aged && <Badge tone="danger">Prioritaire</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-a-text-2">{itemsSummary}</p>
                    <p className={`mt-0.5 text-xs ${aged ? 'font-semibold text-tone-danger-fg' : 'text-a-text-3'}`}>{elapsedLabel(session.created_at)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 sm:justify-end">
                    <span className="mr-1 text-sm font-semibold tabular-nums text-a-text">{formatPrice(total, tenantCurrency)}</span>
                    <ButtonLink href={`/admin/paiements-en-attente/${session.id}`} size="sm"><IconSettings size={14} aria-hidden="true" /> Gérer</ButtonLink>
                    <ConfirmPaymentButton
                      endpoint={`/api/admin/checkout-sessions/${session.id}/confirm-payment`}
                      label="Confirmer réception"
                      confirmingLabel="Confirmation…"
                      className={buttonClasses({ variant: 'primary', size: 'sm' })}
                      onSuccess={(warning) => {
                        if (!warning) setResolvedIds((prev) => new Set(prev).add(session.id));
                        router.refresh();
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
