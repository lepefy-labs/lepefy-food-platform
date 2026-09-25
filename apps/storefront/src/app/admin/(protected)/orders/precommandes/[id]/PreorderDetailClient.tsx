'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  IconAlertTriangle, IconArrowBackUp, IconBuildingStore, IconCash, IconCheck, IconCircleCheck, IconEdit,
  IconExternalLink, IconLink, IconLoader2, IconMapPin, IconRefresh, IconX,
} from '@tabler/icons-react';
import type { AssistedOrderEventType, ManualPaymentMethod } from '@lepefy/types';
import { MANUAL_PAYMENT_METHOD_LABELS, SALES_CHANNEL_LABELS } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import {
  MANUAL_PAYMENT_METHODS, buildPayLinkMessage, buildTrackingShareMessage,
} from '@/lib/orders/assisted/assistedOrderPolicy';
import ShareLinkActions from '../../../../_components/ui/ShareLinkActions';
import ConfirmActionModal from '../../../../_components/ui/ConfirmActionModal';
import PreorderStatusBadge from '../../_assisted/PreorderStatusBadge';
import type { PreorderDetailResponse } from '../../_assisted/types';

const EVENT_LABELS: Record<AssistedOrderEventType, string> = {
  created: 'Précommande créée',
  updated: 'Précommande modifiée',
  link_issued: 'Lien de paiement généré',
  link_revoked: 'Lien de paiement désactivé',
  link_opened: 'Lien consulté par le client',
  payment_declared: 'Paiement externe déclaré',
  payment_confirmed: 'Paiement confirmé',
  order_created: 'Commande créée',
  reopened: 'Remise en attente de paiement',
  cancelled: 'Précommande annulée',
  expired: 'Lien expiré',
  stock_conflict: 'Conflit de stock à la conversion',
  duplicate_payment: 'Second paiement reçu (remboursé)',
  amount_mismatch: 'Montant payé différent du total',
  notification_sent: 'Récapitulatif envoyé par e-mail',
  notification_skipped: 'Récapitulatif e-mail non envoyé',
};

const SOURCE_LABELS: Record<string, string> = {
  stripe_webhook: 'carte bancaire (Stripe)',
  admin_verified: 'vérifié par l’équipe',
  admin_recorded: 'enregistré par l’équipe',
};

const NOTIFICATION_LABELS: Record<string, string> = {
  skipped_no_email: 'pas d’e-mail client',
  skipped_by_choice: 'non demandé',
  skipped_unconfigured: 'notifications non configurées',
  failed: 'échec d’envoi',
};

const inputClass = 'min-h-11 w-full rounded-xl border border-[var(--admin-border)] bg-white px-3 text-base text-gray-900 outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 sm:text-sm';
const cardClass = 'rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5';

function dateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function nowLocalInput(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function eventDetail(type: AssistedOrderEventType, detail: Record<string, unknown>, currency: string): string | null {
  if (type === 'payment_confirmed' && typeof detail.source === 'string') return SOURCE_LABELS[detail.source] ?? null;
  if (type === 'order_created' && typeof detail.order_number === 'string') return detail.order_number;
  if (type === 'notification_skipped' && typeof detail.outcome === 'string') return NOTIFICATION_LABELS[detail.outcome] ?? null;
  if (type === 'payment_declared' && typeof detail.label === 'string') return detail.label;
  if (type === 'payment_declared' && typeof detail.method === 'string') return MANUAL_PAYMENT_METHOD_LABELS[detail.method as ManualPaymentMethod] ?? detail.method;
  if (type === 'link_issued' && detail.repriced === true && typeof detail.total === 'number') return `Prix actualisés : ${formatPrice(detail.total, currency)}`;
  if (type === 'updated' && typeof detail.total === 'number') return `Nouveau total : ${formatPrice(detail.total, currency)}`;
  if (type === 'stock_conflict') return detail.refund_succeeded === true ? 'Remboursement Stripe effectué' : 'Intervention manuelle requise';
  if (type === 'cancelled' && typeof detail.reason === 'string') return detail.reason;
  return null;
}

export default function PreorderDetailClient({ preorderId, notice }: { preorderId: string; notice: 'created' | 'updated' | null }) {
  const [data, setData] = useState<PreorderDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState(false);
  const [paidMethod, setPaidMethod] = useState<ManualPaymentMethod>('cash');
  const [paidAt, setPaidAt] = useState(nowLocalInput);
  const [paidReference, setPaidReference] = useState('');
  const [paidNote, setPaidNote] = useState('');
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/assisted-orders/${preorderId}`, { cache: 'no-store' });
    const body = await res.json().catch(() => null) as (PreorderDetailResponse & { error?: string }) | null;
    if (!res.ok || !body?.preorder) { setLoadError(body?.error ?? 'Précommande introuvable.'); return; }
    setData(body);
    setPaidReference((current) => current || body.preorder.declaredPayment?.reference || '');
    setNotifyCustomer(body.preorder.notifyCustomer && Boolean(body.preorder.email));
  }, [preorderId]);

  useEffect(() => { void load(); }, [load]);

  async function run(action: string, url: string, body?: Record<string, unknown>) {
    setBusy(action);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      });
      const result = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok) {
        setError(typeof result?.error === 'string' ? result.error : 'Action impossible. Réessayez.');
        await load();
        return null;
      }
      await load();
      return result;
    } catch {
      setError('Connexion impossible. Réessayez.');
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{loadError}</p>;
  }
  if (!data) {
    return <p className="flex items-center gap-2 py-12 text-sm text-gray-500"><IconLoader2 size={16} className="animate-spin" /> Chargement…</p>;
  }

  const { preorder, actions, events, tenantName, currency } = data;
  const can = (action: string) => actions.includes(action as never);
  const verifying = preorder.status === 'awaiting_verification';
  const payMessage = preorder.payUrl
    ? buildPayLinkMessage({
        customerName: preorder.fullName, reference: preorder.reference,
        totalLabel: formatPrice(preorder.totals.total, currency), url: preorder.payUrl, tenantName,
      })
    : '';

  async function issueLink() {
    const result = await run('link', `/api/admin/assisted-orders/${preorderId}/link`);
    if (result?.repriced === true && typeof result.total === 'number') {
      setInfo(`Nouveau lien généré. Les prix ont été actualisés au catalogue : nouveau total ${formatPrice(result.total, currency)}.`);
    } else if (result) {
      setInfo('Nouveau lien généré. L’ancien lien ne fonctionne plus.');
    }
  }

  async function confirmPayment() {
    const result = await run('confirm', `/api/admin/assisted-orders/${preorderId}/confirm-payment`, {
      ...(verifying ? {} : { method: paidMethod }),
      receivedAt: new Date(paidAt).toISOString(),
      reference: paidReference.trim() || null,
      note: paidNote.trim() || null,
      notifyCustomer: Boolean(preorder.email) && notifyCustomer,
    });
    if (result) {
      setPaymentForm(false);
      setInfo(typeof result.warning === 'string' ? result.warning : 'Paiement confirmé : la commande a été créée.');
    }
  }

  return (
    <div className="space-y-4">
      {notice === 'created' && !info && (
        <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <IconCircleCheck size={18} /> Précommande enregistrée{preorder.payUrl ? ' — envoyez maintenant le lien au client.' : '.'}
        </p>
      )}
      {notice === 'updated' && !info && (
        <p className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-800">
          <IconCheck size={18} /> Modifications enregistrées. La précommande est en brouillon : générez un nouveau lien pour la faire payer.
        </p>
      )}
      {info && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" role="status">{info}</p>}
      {error && <p className="flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700" role="alert"><IconAlertTriangle size={18} className="mt-0.5 shrink-0" />{error}</p>}

      <header className={`${cardClass} flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold text-gray-950 dark:text-gray-100">{preorder.reference}</h1>
            <PreorderStatusBadge status={preorder.status} />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {preorder.salesChannel ? SALES_CHANNEL_LABELS[preorder.salesChannel] : '—'} · créée le {dateTime(preorder.createdAt)}{preorder.createdBy ? ` par ${preorder.createdBy}` : ''}
          </p>
          {preorder.status === 'open' && <p className="mt-1 text-xs text-gray-500">Lien valable jusqu’au {dateTime(preorder.expiresAt)} · prix garantis jusqu’à cette date</p>}
        </div>
        <div className="text-left sm:text-right">
          <p className="text-xs uppercase tracking-wide text-gray-400">Total</p>
          <p className="text-2xl font-semibold text-gray-950 dark:text-gray-100">{formatPrice(preorder.totals.total, currency)}</p>
        </div>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {/* Paiement / actions principales */}
          {preorder.order ? (
            <section className={cardClass}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300"><IconCircleCheck size={18} /> Commande {preorder.order.number}</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Le paiement est confirmé : la commande suit le parcours normal (préparation, expédition, suivi).</p>
              <Link href={`/admin/orders/${preorder.order.id}`} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white">Ouvrir la commande <IconExternalLink size={16} /></Link>
              {preorder.order.trackingLink && (
                <div className="mt-4">
                  <p className="mb-2 text-xs text-gray-500">{preorder.email ? 'Lien de suivi client :' : 'Le client n’a pas d’e-mail : partagez-lui le lien de suivi.'}</p>
                  <ShareLinkActions
                    url={preorder.order.trackingLink} phone={preorder.phone} copyLabel="Copier le lien de suivi"
                    message={buildTrackingShareMessage({ customerName: preorder.fullName, orderNumber: preorder.order.number, url: preorder.order.trackingLink, tenantName })}
                  />
                </div>
              )}
            </section>
          ) : preorder.status === 'cancelled' ? (
            <section className={cardClass}><p className="text-sm text-gray-600">Précommande annulée. Aucun paiement n’est possible.</p></section>
          ) : (
            <section className={cardClass}>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Paiement</h2>

              {verifying && preorder.declaredPayment && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  <p className="font-semibold">Paiement déclaré : {preorder.declaredPayment.label ?? preorder.declaredPayment.method}</p>
                  <p className="mt-1 text-xs">Déclaré le {dateTime(preorder.declaredPayment.declaredAt)}{preorder.declaredPayment.reference ? ` · réf. ${preorder.declaredPayment.reference}` : ''}. Vérifiez la réception sur votre compte avant de confirmer.</p>
                </div>
              )}

              {preorder.shippingPending && (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">Frais de livraison non calculés : modifiez la précommande avant d’envoyer un lien.</p>
              )}

              {preorder.payUrl && can('share_link') && (
                <div className="mt-3">
                  <p className="mb-2 text-xs text-gray-500">Lien de paiement (version {preorder.payLinkVersion}) — à envoyer au client :</p>
                  <ShareLinkActions url={preorder.payUrl} phone={preorder.phone} message={payMessage} />
                </div>
              )}

              {preorder.status === 'expired' && (
                <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-sm text-orange-800">Le lien a expiré. Un nouveau lien revérifie disponibilité, prix et livraison.</p>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {can('issue_link') && !preorder.shippingPending && (
                  <button type="button" onClick={issueLink} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === 'link' ? <IconLoader2 size={16} className="animate-spin" /> : preorder.payUrl ? <IconRefresh size={16} /> : <IconLink size={16} />}
                    {preorder.payUrl ? 'Régénérer le lien' : preorder.status === 'expired' ? 'Générer un nouveau lien' : 'Générer le lien de paiement'}
                  </button>
                )}
                {(can('confirm_payment') || can('record_payment')) && !paymentForm && (
                  <button type="button" onClick={() => setPaymentForm(true)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-600 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300">
                    <IconCash size={16} /> {verifying ? 'Confirmer la réception' : 'Encaissement reçu'}
                  </button>
                )}
                {can('reopen') && (
                  <button type="button" onClick={() => run('reopen', `/api/admin/assisted-orders/${preorderId}/reopen`)} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--admin-border)] px-4 text-sm font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200">
                    <IconArrowBackUp size={16} /> Paiement non reçu : remettre en attente
                  </button>
                )}
                {can('edit') && (
                  <Link href={`/admin/orders/precommandes/${preorderId}/modifier`} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--admin-border)] px-4 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200">
                    <IconEdit size={16} /> Modifier
                  </Link>
                )}
                {can('cancel') && (
                  <button type="button" onClick={() => setCancelOpen(true)} disabled={Boolean(busy)} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
                    <IconX size={16} /> Annuler
                  </button>
                )}
              </div>

              {paymentForm && (
                <div className="mt-4 space-y-3 rounded-xl border border-emerald-200 p-3 dark:border-emerald-900">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {verifying ? 'Confirmer l’encaissement déclaré' : 'Enregistrer un encaissement reçu'} · {formatPrice(preorder.totals.total, currency)}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {!verifying && (
                      <label className="text-xs text-gray-500">Moyen *
                        <select value={paidMethod} onChange={(e) => setPaidMethod(e.target.value as ManualPaymentMethod)} className={`${inputClass} mt-1`}>
                          {MANUAL_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{MANUAL_PAYMENT_METHOD_LABELS[method]}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="text-xs text-gray-500">Date de réception *<input type="datetime-local" value={paidAt} max={nowLocalInput()} onChange={(e) => setPaidAt(e.target.value)} className={`${inputClass} mt-1`} /></label>
                    <label className="text-xs text-gray-500">Référence<input value={paidReference} onChange={(e) => setPaidReference(e.target.value)} className={`${inputClass} mt-1`} /></label>
                    <label className="text-xs text-gray-500">Note<input value={paidNote} onChange={(e) => setPaidNote(e.target.value)} className={`${inputClass} mt-1`} /></label>
                  </div>
                  <label className={`flex min-h-11 items-center gap-2 text-sm ${preorder.email ? '' : 'text-gray-400'}`}>
                    <input type="checkbox" className="h-5 w-5" checked={Boolean(preorder.email) && notifyCustomer} disabled={!preorder.email} onChange={(e) => setNotifyCustomer(e.target.checked)} />
                    {preorder.email ? 'Envoyer le récapitulatif de commande par e-mail' : 'Pas d’e-mail : lien de suivi à partager après confirmation'}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={confirmPayment} disabled={Boolean(busy) || !paidAt} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                      {busy === 'confirm' ? <IconLoader2 size={16} className="animate-spin" /> : <IconCheck size={16} />} Confirmer et créer la commande
                    </button>
                    <button type="button" onClick={() => setPaymentForm(false)} className="min-h-11 rounded-xl px-4 text-sm font-semibold text-gray-600">Fermer</button>
                  </div>
                  <p className="text-xs text-gray-500">Action tracée avec votre identité. Une seule commande peut être créée pour cette précommande.</p>
                </div>
              )}
            </section>
          )}

          {/* Articles */}
          <section className={cardClass}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Produits</h2>
            <ul className="mt-2 divide-y divide-[var(--admin-border)] dark:divide-gray-800">
              {preorder.items.map((item) => (
                <li key={item.productId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0"><span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span><span className="text-gray-500"> · {item.quantity} × {formatPrice(item.price, currency)}</span></span>
                  <span className="font-semibold">{formatPrice(item.price * item.quantity, currency)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-2 space-y-1 border-t border-[var(--admin-border)] pt-2 text-sm dark:border-gray-800">
              <div className="flex justify-between"><dt className="text-gray-500">Articles</dt><dd>{formatPrice(preorder.totals.subtotal, currency)}</dd></div>
              {preorder.totals.discount > 0 && <div className="flex justify-between text-emerald-700"><dt>Remise</dt><dd>−{formatPrice(preorder.totals.discount, currency)}</dd></div>}
              <div className="flex justify-between"><dt className="text-gray-500">{preorder.fulfillmentType === 'pickup' ? 'Retrait' : 'Livraison'}</dt><dd>{preorder.shippingPending ? 'À calculer' : formatPrice(preorder.totals.shippingTotal, currency)}</dd></div>
              <div className="flex justify-between font-bold"><dt>Total</dt><dd>{formatPrice(preorder.totals.total, currency)}</dd></div>
            </dl>
          </section>
        </div>

        <div className="space-y-4">
          <section className={cardClass}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Client</h2>
            <p className="mt-2 text-sm font-medium">{preorder.fullName ?? '—'}</p>
            <p className="text-sm text-gray-600 dark:text-gray-300">{preorder.phone ?? 'Téléphone absent'}</p>
            <p className="break-all text-sm text-gray-600 dark:text-gray-300">{preorder.email ?? 'E-mail absent'}</p>
            {preorder.customerId && <Link href={`/admin/clients/${preorder.customerId}`} className="mt-2 inline-flex min-h-9 items-center text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">Fiche client →</Link>}
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-[var(--admin-surface-subtle)] p-3 text-sm dark:bg-gray-950/40">
              {preorder.fulfillmentType === 'pickup' ? <IconBuildingStore size={17} className="mt-0.5 shrink-0" /> : <IconMapPin size={17} className="mt-0.5 shrink-0" />}
              {preorder.fulfillmentType === 'pickup' || !preorder.shippingAddress ? <span>Retrait en magasin</span> : (
                <span>{preorder.shippingAddress.full_name}<br />{preorder.shippingAddress.line1}{preorder.shippingAddress.line2 ? `, ${preorder.shippingAddress.line2}` : ''}<br />{preorder.shippingAddress.postal_code} {preorder.shippingAddress.city} · {preorder.shippingAddress.country}</span>
              )}
            </div>
            {preorder.adminNote && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/20 dark:text-amber-200"><strong className="block text-xs">Note interne</strong>{preorder.adminNote}</p>}
          </section>

          <section className={cardClass}>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Historique</h2>
            {events.length === 0 ? <p className="mt-2 text-sm text-gray-400">Aucun événement.</p> : (
              <ol className="mt-3 space-y-3">
                {events.map((event) => {
                  const detail = eventDetail(event.event_type, event.detail ?? {}, currency);
                  return (
                    <li key={event.id} className="border-l-2 border-[var(--admin-primary-soft)] pl-3">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{EVENT_LABELS[event.event_type] ?? event.event_type}</p>
                      {detail && <p className="text-xs text-gray-600 dark:text-gray-300">{detail}</p>}
                      <p className="text-[11px] text-gray-400">{dateTime(event.created_at)} · {event.actor_type === 'customer' ? 'client' : event.actor_type === 'system' ? 'automatique' : 'équipe'}</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </div>

      <ConfirmActionModal
        open={cancelOpen}
        title="Annuler cette précommande ?"
        description="Le client ne pourra plus payer avec son lien. Aucune commande ne sera créée. Cette action est définitive."
        confirmLabel="Annuler la précommande"
        cancelLabel="Garder"
        destructive
        loading={busy === 'cancel'}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async () => {
          const result = await run('cancel', `/api/admin/assisted-orders/${preorderId}/cancel`);
          setCancelOpen(false);
          if (result) setInfo('Précommande annulée.');
        }}
      />
    </div>
  );
}
