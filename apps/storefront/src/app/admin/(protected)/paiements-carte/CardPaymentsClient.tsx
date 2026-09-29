'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconCalendar, IconCheck, IconChevronDown, IconCopy, IconExternalLink, IconMail, IconRefresh, IconSearch } from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import { shopDay, type CardPaymentDisplayStatus, type CardPaymentPeriod, type CardPaymentStatusFilter } from '@/lib/card/cardPaymentsAdmin';
import ConfirmActionModal from '../../_components/ui/ConfirmActionModal';

interface CardPayment {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  customerName: string | null;
  customerEmail: string | null;
  status: CardPaymentDisplayStatus;
  createdAt: string;
  paidAt: string | null;
  stripePaymentIntentId: string | null;
  stripeUrl: string | null;
}

interface ListResponse {
  total: number;
  page: number;
  pageSize: number;
  currency: string;
  summary: { paidAmount: number; paidCount: number; abandonedCount: number };
  payments: CardPayment[];
}

const PERIODS: Array<[Exclude<CardPaymentPeriod, 'custom'>, string]> = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['30d', '30 jours'], ['all', 'Tout']];
const PERIOD_LABEL: Record<Exclude<CardPaymentPeriod, 'custom'>, string> = { today: 'aujourd’hui', '7d': '7 jours', '30d': '30 jours', all: 'depuis le début' };

// `YYYY-MM-DD` -> `29/09` (or `29/09/2025` outside the current year).
const shortDay = (day: string, today: string) => {
  const [y, m, d] = day.split('-');
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
};
const clockTime = (value: Date) => new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short', timeZone: 'Europe/Rome' }).format(value);

const STATUS: Record<CardPaymentDisplayStatus, { label: string; tone: string }> = {
  paid: { label: 'Payé', tone: 'success' },
  in_progress: { label: 'En cours', tone: 'warn' },
  abandoned: { label: 'Non finalisé', tone: 'neutral' },
};

const dateTime = (value: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(value));
const card = 'rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900';
const chip = (active: boolean) => `min-h-10 rounded-xl border px-3 text-sm font-medium ${active
  ? 'border-[var(--admin-primary)] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] dark:border-violet-500/50 dark:bg-violet-500/15 dark:text-violet-200'
  : 'border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'}`;

function Status({ status }: { status: CardPaymentDisplayStatus }) {
  const meta = STATUS[status];
  const neutral = meta.tone === 'neutral';
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${neutral ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' : ''}`}
      style={neutral ? undefined : { background: `var(--status-${meta.tone}-bg)`, color: `var(--status-${meta.tone}-fg)` }}>
      {meta.label}
    </span>
  );
}

export default function CardPaymentsClient({ initialQuery, canResend }: { initialQuery: string; canResend: boolean }) {
  const [period, setPeriod] = useState<CardPaymentPeriod>('7d');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [status, setStatus] = useState<CardPaymentStatusFilter>('all');
  const [query, setQuery] = useState(initialQuery);
  const [appliedQuery, setAppliedQuery] = useState(initialQuery);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [resendTarget, setResendTarget] = useState<CardPayment | null>(null);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  // Only the latest request may update the page: filters (dates especially)
  // change faster than the API answers, and an older, slower response must
  // not overwrite the current one.
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, status, page: String(page) });
      if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
      if (period === 'custom') {
        if (fromDay) params.set('from', fromDay);
        if (toDay) params.set('to', toDay);
      }
      const response = await fetch(`/api/admin/card-payments?${params}`, { cache: 'no-store', signal: controller.signal });
      const body = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error ?? 'Impossible de charger les paiements.');
      setData(body as ListResponse);
      setUpdatedAt(new Date());
    } catch (loadError) {
      if (controller.signal.aborted) return;
      setError(loadError instanceof Error ? loadError.message : 'Impossible de charger les paiements.');
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, [period, fromDay, toDay, status, page, appliedQuery]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => { load(); }, [load]);
  // A reference search opens its single result directly.
  useEffect(() => {
    if (data?.payments.length === 1 && /^CP-?[0-9A-F]{6}$/i.test(appliedQuery.trim())) setOpenId(data.payments[0]!.id);
  }, [data, appliedQuery]);

  function search(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query);
  }

  async function copy(reference: string) {
    try { await navigator.clipboard.writeText(reference); setCopied(reference); setTimeout(() => setCopied(null), 1500); } catch { /* clipboard blocked */ }
  }

  async function resend() {
    if (!resendTarget) return;
    setResending(true);
    try {
      const response = await fetch(`/api/admin/card-payments/${resendTarget.id}/resend-confirmation`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      setNotice(response.ok
        ? { tone: 'ok', text: `Confirmation ${resendTarget.reference} renvoyée à ${resendTarget.customerEmail}.` }
        : { tone: 'error', text: body.error ?? 'Renvoi impossible.' });
    } finally {
      setResending(false);
      setResendTarget(null);
    }
  }

  const currency = data?.currency ?? 'EUR';
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const referenceSearch = /^CP-?[0-9A-F]{6}$/i.test(appliedQuery.trim());
  const today = shopDay();
  const periodLabel = period !== 'custom' ? PERIOD_LABEL[period]
    : fromDay && toDay ? `${shortDay(fromDay <= toDay ? fromDay : toDay, today)} – ${shortDay(fromDay <= toDay ? toDay : fromDay, today)}`
    : fromDay ? `depuis le ${shortDay(fromDay, today)}`
    : toDay ? `jusqu’au ${shortDay(toDay, today)}`
    : 'depuis le début';

  // First switch to "Personnalisé" starts on the current month so far.
  function selectCustom() {
    if (!fromDay && !toDay) {
      setFromDay(`${today.slice(0, 8)}01`);
      setToDay(today);
    }
    setPeriod('custom');
    setPage(1);
  }

  return (
    <div className="space-y-5">
      <div className={`${card} space-y-4 p-4`}>
        <form onSubmit={search} className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Rechercher</span>
            <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="CP-A82F31, nom ou email"
              className="min-h-11 w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 text-sm dark:border-gray-700 dark:bg-gray-950" />
          </label>
          <button type="submit" className="min-h-11 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white">Rechercher</button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {PERIODS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={period === value} className={chip(period === value)} disabled={referenceSearch}
              onClick={() => { setPeriod(value); setPage(1); }}>{label}</button>
          ))}
          <button type="button" aria-pressed={period === 'custom'} className={`${chip(period === 'custom')} inline-flex items-center gap-1.5`} disabled={referenceSearch}
            onClick={selectCustom}><IconCalendar size={16} />Personnalisé</button>
          <select value={status} onChange={(e) => { setStatus(e.target.value as CardPaymentStatusFilter); setPage(1); }} aria-label="Statut"
            className="min-h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-gray-700 dark:bg-gray-950">
            <option value="all">Tous les statuts</option>
            <option value="paid">Payés</option>
            <option value="unfinished">En cours / non finalisés</option>
          </select>
          {appliedQuery && <button type="button" className="text-sm font-medium text-[var(--admin-primary-fg)] underline-offset-2 hover:underline dark:text-violet-300"
            onClick={() => { setQuery(''); setAppliedQuery(''); setPage(1); }}>Effacer la recherche</button>}
          <button type="button" onClick={load} disabled={loading} className={`${chip(false)} ml-auto inline-flex items-center gap-1.5 disabled:opacity-60`}>
            <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />{loading ? 'Actualisation…' : 'Rafraîchir'}
          </button>
        </div>
        {(period === 'custom' && !referenceSearch) || updatedAt ? (
          <div className="flex flex-wrap items-center gap-2">
            {period === 'custom' && !referenceSearch && (
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
                <label className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="shrink-0">Du</span>
                  <input type="date" value={fromDay} max={today} onChange={(e) => { setFromDay(e.target.value); setPage(1); }}
                    className="min-h-10 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 sm:w-auto" />
                </label>
                <label className="flex min-w-0 items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <span className="shrink-0">au</span>
                  <input type="date" value={toDay} max={today} onChange={(e) => { setToDay(e.target.value); setPage(1); }}
                    className="min-h-10 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 sm:w-auto" />
                </label>
              </div>
            )}
            {updatedAt && <p className="ml-auto text-xs text-gray-400" aria-live="polite">Mis à jour à {clockTime(updatedAt)}</p>}
          </div>
        ) : null}
        {referenceSearch && <p className="text-xs text-gray-500">Recherche par référence : toutes les dates.</p>}
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <Kpi label={`Encaissé · ${periodLabel}`} value={formatPrice(data.summary.paidAmount, currency)} />
          <Kpi label="Paiements payés" value={String(data.summary.paidCount)} />
          <Kpi label="Non finalisés" value={String(data.summary.abandonedCount)} hint="En attente depuis plus d’une heure" />
        </div>
      )}

      {notice && (
        <p role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${notice.tone === 'ok'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'}`}>{notice.text}</p>
      )}

      <section className={card} aria-busy={loading}>
        {error ? (
          <div className="p-6 text-sm text-red-600">{error} <button type="button" className="ml-2 font-semibold underline" onClick={load}>Réessayer</button></div>
        ) : loading && !data ? (
          <div className="p-6 text-sm text-gray-500">Chargement…</div>
        ) : !data || data.payments.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            {appliedQuery ? 'Aucun paiement ne correspond à cette recherche.' : 'Aucun paiement carte sur cette période.'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            <li className="hidden grid-cols-[150px_110px_minmax(0,1fr)_110px_120px_24px] gap-3 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
              <span>Date</span><span>Référence</span><span>Client</span><span className="text-right">Montant</span><span>Statut</span><span />
            </li>
            {data.payments.map((payment) => {
              const open = openId === payment.id;
              return (
                <li key={payment.id}>
                  <button type="button" onClick={() => setOpenId(open ? null : payment.id)} aria-expanded={open}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60 md:grid-cols-[150px_110px_minmax(0,1fr)_110px_120px_24px] md:items-center">
                    <span className="order-3 text-xs text-gray-500 md:order-none md:text-sm md:text-gray-700 md:dark:text-gray-300">{dateTime(payment.createdAt)}</span>
                    <span className="order-1 font-mono text-sm font-semibold text-gray-900 dark:text-gray-100 md:order-none">{payment.reference}</span>
                    <span className="order-5 min-w-0 truncate text-gray-700 dark:text-gray-300 md:order-none">
                      {payment.customerName || payment.customerEmail
                        ? <>{payment.customerName ?? ''}{payment.customerName && payment.customerEmail ? ' · ' : ''}<span className="text-gray-500">{payment.customerEmail ?? ''}</span></>
                        : <span className="italic text-gray-400">Non renseigné</span>}
                    </span>
                    <span className="order-2 text-right font-semibold text-gray-900 dark:text-gray-100 md:order-none">{formatPrice(payment.amount, payment.currency.toUpperCase())}</span>
                    <span className="order-4 justify-self-end md:order-none md:justify-self-start"><Status status={payment.status} /></span>
                    <IconChevronDown size={18} className={`hidden text-gray-400 transition-transform md:block ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && (
                    <div className="space-y-3 border-t border-gray-100 bg-gray-50/70 px-4 py-4 text-sm dark:border-gray-800 dark:bg-gray-950/40">
                      <dl className="grid gap-2 sm:grid-cols-2">
                        <Detail label="Client" value={payment.customerName ?? 'Non renseigné'} />
                        <Detail label="Email" value={payment.customerEmail ?? 'Non renseigné'} />
                        <Detail label="Créé le" value={dateTime(payment.createdAt)} />
                        <Detail label="Payé le" value={payment.paidAt ? dateTime(payment.paidAt) : '—'} />
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-gray-500">Paiement Stripe</dt>
                          <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-xs text-gray-700 dark:text-gray-300">
                            <span className="break-all">{payment.stripePaymentIntentId ?? 'Non créé (tentative interrompue)'}</span>
                            {payment.stripeUrl && <a href={payment.stripeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-sans font-semibold text-[var(--admin-primary-fg)] dark:text-violet-300">Ouvrir dans Stripe <IconExternalLink size={14} /></a>}
                          </dd>
                        </div>
                      </dl>
                      {payment.status === 'in_progress' && <p className="text-xs text-amber-700 dark:text-amber-300">Paiement en attente de confirmation par Stripe (validation bancaire possible). Ne demandez pas un second paiement au client.</p>}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => copy(payment.reference)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-300 px-3 font-semibold text-gray-800 hover:bg-white dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">
                          {copied === payment.reference ? <IconCheck size={16} /> : <IconCopy size={16} />} {copied === payment.reference ? 'Copié' : 'Copier la référence'}
                        </button>
                        {canResend && payment.status === 'paid' && payment.customerEmail && (
                          <button type="button" onClick={() => setResendTarget(payment)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-300 px-3 font-semibold text-gray-800 hover:bg-white dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-800">
                            <IconMail size={16} /> Renvoyer la confirmation
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data && pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <button type="button" className={chip(false)} disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Précédent</button>
          <span className="text-gray-500">Page {page} / {pages} · {data.total} paiements</span>
          <button type="button" className={chip(false)} disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Suivant</button>
        </nav>
      )}

      <ConfirmActionModal
        open={resendTarget !== null}
        title="Renvoyer la confirmation ?"
        description={resendTarget ? `L’email de confirmation ${resendTarget.reference} (${formatPrice(resendTarget.amount, resendTarget.currency.toUpperCase())}) sera renvoyé à ${resendTarget.customerEmail}.` : ''}
        confirmLabel="Renvoyer"
        loading={resending}
        onConfirm={resend}
        onCancel={() => setResendTarget(null)}
      />
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${card} min-w-0 p-3 sm:p-4`}>
      <p className="text-[11px] leading-tight text-gray-500 dark:text-gray-400 sm:text-xs">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold text-gray-950 dark:text-white sm:text-2xl">{value}</p>
      {hint && <p className="mt-0.5 hidden text-xs text-gray-400 sm:block">{hint}</p>}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 break-words text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  );
}
