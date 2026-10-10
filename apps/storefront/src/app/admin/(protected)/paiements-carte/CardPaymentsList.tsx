'use client';

import { useState } from 'react';
import { IconAlertTriangle, IconChevronDown, IconExternalLink, IconMail } from '@tabler/icons-react';
import { CARD_NOTIFICATION_LABELS, isNotificationProblem, type CardNotificationState, type CardPaymentDisplayStatus } from '@/lib/card/cardPaymentsAdmin';
import type { CardNotificationInfo, CardPaymentListItem } from '@/lib/card/cardPaymentsList';
import { formatOperationalDuration } from '@/lib/orders/adminOrderOperations';
import { formatDate, formatMoney } from '@/lib/admin/format';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import Badge from '../../_components/ui/Badge';
import Button, { ButtonLink } from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import CopyableValue from '../../_components/ui/CopyableValue';
import { DescriptionItem, DescriptionList } from '../../_components/ui/Panel';
import { EmptyState } from '../../_components/ui/States';
import { useAdminToast } from '../../_components/ui/Toaster';

const STATUS: Record<CardPaymentDisplayStatus, { label: string; tone: AdminTone }> = {
  paid: { label: 'Payé', tone: 'success' },
  in_progress: { label: 'En cours', tone: 'warning' },
  abandoned: { label: 'Non finalisé', tone: 'neutral' },
};

const NOTIFICATION_TONE: Record<CardNotificationState, string> = {
  sent: 'text-tone-success-fg',
  sending: 'text-a-text-2',
  retrying: 'text-tone-warning-fg',
  dead: 'text-tone-danger-fg',
  untracked: 'text-a-text-3',
  no_email: 'text-a-text-3',
  not_applicable: 'text-a-text-3',
};

const GRID = 'md:grid-cols-[130px_110px_minmax(0,1fr)_110px_170px_24px]';

/** The one line a row shows under its status: a real email problem, or how long a payment has been pending. */
function rowHint(payment: CardPaymentListItem, now: number): { text: string; problem: boolean } | null {
  if (payment.status === 'in_progress') {
    const hours = (now - Date.parse(payment.createdAt)) / 3_600_000;
    return Number.isFinite(hours) ? { text: `depuis ${formatOperationalDuration(Math.max(0, hours))}`, problem: false } : null;
  }
  if (isNotificationProblem(payment.notifications.customer.state)) return { text: `Confirmation : ${CARD_NOTIFICATION_LABELS[payment.notifications.customer.state].toLowerCase()}`, problem: true };
  if (isNotificationProblem(payment.notifications.team.state)) return { text: `Alerte équipe : ${CARD_NOTIFICATION_LABELS[payment.notifications.team.state].toLowerCase()}`, problem: true };
  return null;
}

/** Rows of the server-rendered list: expandable details and « Renvoyer la confirmation ». */
export default function CardPaymentsList({ payments, canResend, autoOpenId, searched, resetHref }: {
  payments: CardPaymentListItem[];
  canResend: boolean;
  autoOpenId: string | null;
  searched: boolean;
  resetHref: string;
}) {
  const toast = useAdminToast();
  const [openId, setOpenId] = useState<string | null>(autoOpenId);
  const [resendTarget, setResendTarget] = useState<CardPaymentListItem | null>(null);
  const [resending, setResending] = useState(false);
  const [now] = useState(() => Date.now());

  async function resend() {
    if (!resendTarget) return;
    setResending(true);
    try {
      const response = await fetch(`/api/admin/card-payments/${resendTarget.id}/resend-confirmation`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (response.ok) toast.success(`Confirmation ${resendTarget.reference} renvoyée`, { description: `Envoyée à ${resendTarget.customerEmail}.` });
      else toast.error('Renvoi impossible', { description: body.error ?? undefined });
    } catch {
      toast.error('Renvoi impossible', { description: 'Vérifiez la connexion puis réessayez.' });
    } finally {
      setResending(false);
      setResendTarget(null);
    }
  }

  if (payments.length === 0) {
    return searched
      ? <EmptyState variant="filtered" title="Aucun paiement ne correspond à cette recherche." action={<ButtonLink href={resetHref}>Effacer la recherche</ButtonLink>} />
      : <EmptyState title="Aucun paiement carte sur cette période." />;
  }

  return (
    <>
      <ul className="divide-y divide-a-border">
        <li className={cn('hidden gap-3 bg-a-surface-2 px-4 py-2 text-xs font-semibold text-a-text-2 md:grid', GRID)}>
          <span>Date</span><span>Référence</span><span>Client</span><span className="text-right">Montant</span><span>Statut</span><span />
        </li>
        {payments.map((payment) => {
          const open = openId === payment.id;
          const hint = rowHint(payment, now);
          const meta = STATUS[payment.status];
          return (
            <li key={payment.id}>
              <button type="button" onClick={() => setOpenId(open ? null : payment.id)} aria-expanded={open} aria-controls={`card-payment-${payment.id}`}
                className={cn('grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-a-focus md:items-center', GRID)}>
                <span className="order-3 text-xs text-a-text-3 md:order-none md:text-sm md:text-a-text-2"><time dateTime={payment.createdAt} title={formatDate(payment.createdAt, 'datetime')}>{formatDate(payment.createdAt, 'short')}</time></span>
                <span className="order-1 font-mono text-sm font-semibold text-a-text md:order-none">{payment.reference}</span>
                <span className="order-5 col-span-2 min-w-0 truncate text-a-text-2 md:order-none md:col-span-1">
                  {payment.customerName || payment.customerEmail
                    ? <>{payment.customerName ?? ''}{payment.customerName && payment.customerEmail ? ' · ' : ''}<span className="text-a-text-3">{payment.customerEmail ?? ''}</span></>
                    : <span className="italic text-a-text-3">Non renseigné</span>}
                </span>
                <span className="order-2 text-right font-semibold tabular-nums text-a-text md:order-none">{formatMoney(payment.amount, payment.currency.toUpperCase())}</span>
                <span className="order-4 flex flex-col items-end gap-0.5 justify-self-end md:order-none md:items-start md:justify-self-start">
                  <Badge tone={meta.tone} dot>{meta.label}</Badge>
                  {hint && <span className={cn('inline-flex items-start gap-1 text-xs', hint.problem ? 'font-semibold text-tone-warning-fg' : 'text-a-text-3')}>{hint.problem && <IconAlertTriangle size={12} aria-hidden="true" className="mt-px shrink-0" />}{hint.text}</span>}
                </span>
                <IconChevronDown size={18} aria-hidden="true" className={cn('hidden text-a-text-3 transition-transform md:block', open && 'rotate-180')} />
              </button>
              {open && (
                <div id={`card-payment-${payment.id}`} className="space-y-3 border-t border-a-border bg-a-surface-2 px-4 py-4 text-sm">
                  <DescriptionList>
                    <DescriptionItem label="Client">{payment.customerName ?? 'Non renseigné'}</DescriptionItem>
                    <DescriptionItem label="Email">{payment.customerEmail ?? 'Non renseigné'}</DescriptionItem>
                    <DescriptionItem label="Créé le">{formatDate(payment.createdAt, 'datetime')}</DescriptionItem>
                    <DescriptionItem label="Payé le">{payment.paidAt ? formatDate(payment.paidAt, 'datetime') : '—'}</DescriptionItem>
                    <DescriptionItem label="Référence client"><CopyableValue label="Réf." value={payment.reference} /></DescriptionItem>
                    <DescriptionItem label="Paiement Stripe">
                      <span className="flex flex-wrap items-center gap-2">
                        {payment.stripePaymentIntentId ? <CopyableValue label="PI" value={payment.stripePaymentIntentId} /> : <span className="text-a-text-3">Non créé (tentative interrompue)</span>}
                        {payment.stripeUrl && <a href={payment.stripeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 font-semibold text-a-brand-fg hover:underline">Ouvrir dans Stripe <IconExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span></a>}
                      </span>
                    </DescriptionItem>
                    {payment.status === 'paid' && (
                      <DescriptionItem label="Notifications automatiques">
                        <NotificationLine label="Confirmation client" info={payment.notifications.customer} />
                        <NotificationLine label="Alerte équipe" info={payment.notifications.team} />
                      </DescriptionItem>
                    )}
                  </DescriptionList>
                  {payment.status === 'in_progress' && <p className="text-xs text-tone-warning-fg">Paiement en attente de confirmation par Stripe (validation bancaire possible). Ne demandez pas un second paiement au client.</p>}
                  {canResend && payment.status === 'paid' && payment.customerEmail && (
                    <Button variant="secondary" onClick={() => setResendTarget(payment)}><IconMail size={16} aria-hidden="true" /> Renvoyer la confirmation</Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={resendTarget !== null}
        title="Renvoyer la confirmation ?"
        description={resendTarget ? `L’email de confirmation ${resendTarget.reference} (${formatMoney(resendTarget.amount, resendTarget.currency.toUpperCase())}) sera renvoyé à ${resendTarget.customerEmail}.` : ''}
        confirmLabel="Renvoyer"
        loading={resending}
        onConfirm={resend}
        onCancel={() => setResendTarget(null)}
      />
    </>
  );
}

function NotificationLine({ label, info }: { label: string; info: CardNotificationInfo }) {
  return (
    <span className="block text-xs">
      <span className="text-a-text-2">{label} : </span>
      <span className={cn('font-medium', NOTIFICATION_TONE[info.state])}>{CARD_NOTIFICATION_LABELS[info.state]}</span>
      {info.state === 'sent' && info.acceptedAt && <span className="text-a-text-3"> · {formatDate(info.acceptedAt, 'datetime')}</span>}
    </span>
  );
}
