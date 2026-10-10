'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconLink, IconLoader2, IconSearch, IconX } from '@tabler/icons-react';
import { SALES_CHANNEL_LABELS } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { PREORDER_GROUP_LABELS, parsePreorderView, type PreorderView } from '@/lib/orders/assisted/preorderQueue';
import type { PreorderQueueResult } from '@/lib/orders/assisted/loadPreorderQueue';
import ConfirmDialog from '../../../_components/ui/ConfirmDialog';
import { useAdminToast } from '../../../_components/ui/Toaster';
import PreorderStatusBadge from '../_assisted/PreorderStatusBadge';

// Cancelled straight from the list only when nothing can be in flight: an expired link or a
// draft. An active link or a payment declared by the customer is cancelled from the detail page.
// Uses the queue group (effective status: an open link past its TTL is in « Liens expirés »).
const LIST_CANCELLABLE = new Set(['expired', 'draft']);

type QueueItem = PreorderQueueResult['preorders'][number];

const KPI_CARDS: Array<{ group: keyof PreorderQueueResult['kpis']; label: string; helper: string; tone: string }> = [
  { group: 'to_verify', label: 'À vérifier', helper: 'Paiement déclaré par le client', tone: 'border-tone-warning-border bg-tone-warning-bg' },
  { group: 'expired', label: 'Liens expirés', helper: 'Nouveau lien ou annulation', tone: 'border-tone-urgent-border bg-tone-urgent-bg' },
  { group: 'draft', label: 'Brouillons', helper: 'À compléter et envoyer', tone: 'border-a-border bg-a-surface-2' },
  { group: 'waiting', label: 'Attente client', helper: 'Lien envoyé, paiement attendu', tone: 'border-tone-info-border bg-tone-info-bg' },
];

export default function PreordersListClient({ currency, canManage }: { currency: string; canManage: boolean }) {
  const toast = useAdminToast();
  const [cancelTarget, setCancelTarget] = useState<QueueItem | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parsePreorderView(searchParams.get('view'));
  const urlQuery = searchParams.get('q') ?? '';
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const [query, setQuery] = useState(urlQuery);
  const [data, setData] = useState<PreorderQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // List state lives in the URL: back from a preorder keeps view, search and page.
  const navigate = useCallback((patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value); else params.delete(key);
    }
    if (!('page' in patch)) params.delete('page');
    if (params.get('view') === 'to_treat') params.delete('view');
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  useEffect(() => { setQuery(urlQuery); }, [urlQuery]);
  useEffect(() => {
    if (query === urlQuery) return;
    const timer = window.setTimeout(() => navigate({ q: query.trim() || null }), 300);
    return () => window.clearTimeout(timer);
  }, [query, urlQuery, navigate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ view, page: String(page) });
    if (urlQuery) params.set('q', urlQuery);
    fetch(`/api/admin/assisted-orders?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => null) as (PreorderQueueResult & { error?: string }) | null;
        if (cancelled) return;
        if (!res.ok || !body) { setError(body?.error ?? 'Chargement impossible.'); return; }
        setData(body);
      })
      .catch(() => { if (!cancelled) setError('Connexion impossible.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, page, urlQuery, reloadKey]);

  const tabs: Array<{ key: PreorderView; label: string; count?: number }> = [
    { key: 'to_treat', label: 'À traiter', count: data?.toTreatCount },
    { key: 'waiting', label: 'Attente client', count: data?.kpis.waiting },
    { key: 'completed', label: 'Payées', count: data?.finishedCounts.completed },
    { key: 'cancelled', label: 'Annulées', count: data?.finishedCounts.cancelled },
    { key: 'all', label: 'Toutes' },
  ];
  const preorders = data?.preorders ?? [];

  async function cancelPreorder(reason?: string) {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/admin/assisted-orders/${cancelTarget.id}/cancel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason || undefined }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (res.ok) {
        toast.success(`Précommande ${cancelTarget.reference} annulée`, { description: 'Elle reste consultable dans « Annulées ».' });
        setReloadKey((key) => key + 1);
      } else {
        toast.error('Annulation impossible', { description: body.error });
      }
    } catch {
      toast.error('Annulation impossible', { description: 'Vérifiez la connexion puis réessayez.' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }
  const grouped = view === 'to_treat' || view === 'waiting' || view === 'all';

  return (
    <div className="space-y-4">
      <section aria-label="File des précommandes" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {KPI_CARDS.map((card) => {
          const target: PreorderView = card.group === 'waiting' ? 'waiting' : 'to_treat';
          const count = data?.kpis[card.group] ?? 0;
          return (
            <Link key={card.group} href={target === 'to_treat' ? pathname : `${pathname}?view=${target}`}
              className={`min-h-[76px] rounded-xl border p-3 focus-visible:outline-2 focus-visible:outline-a-focus ${card.tone}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-a-text">{card.label}</p>
                <span className={`min-w-8 rounded-full px-2 py-0.5 text-center text-sm font-bold ${count > 0 ? 'bg-a-surface text-a-text shadow-sm' : 'bg-a-hover text-a-text-3'}`}>{data ? count : '…'}</span>
              </div>
              <p className="mt-1 text-xs leading-4 text-a-text-3">{card.helper}</p>
            </Link>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-a-border bg-a-surface shadow-sm">
        <div className="flex flex-col gap-2 border-b border-a-border p-2 lg:flex-row lg:items-center lg:justify-between">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Vues des précommandes">
            {tabs.map((tab) => {
              const active = view === tab.key;
              return (
                <button key={tab.key} type="button" aria-current={active ? 'page' : undefined} onClick={() => navigate({ view: tab.key })}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-a-focus ${active ? 'bg-a-brand-soft text-a-brand-fg ring-1 ring-a-border' : 'text-a-text-2 hover:bg-a-surface-2'}`}>
                  {tab.label}
                  {tab.count !== undefined && <span className="min-w-5 rounded-full bg-a-hover px-1.5 py-0.5 text-center text-xs">{tab.count}</span>}
                </button>
              );
            })}
          </nav>
          <div className="relative w-full lg:max-w-xs">
            <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-a-text-3" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client, téléphone, e-mail ou P-…" aria-label="Rechercher une précommande"
              className="h-10 w-full rounded-xl border border-a-border bg-a-surface pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-a-focus" />
          </div>
        </div>

        {data && !data.complete && <p role="status" className="m-3 rounded-lg bg-tone-warning-bg px-3 py-2 text-xs text-tone-warning-fg">Plus de 1 000 précommandes actives : les compteurs sont partiels.</p>}
        {error && <p className="m-3 rounded-lg bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger-fg" role="alert">{error} <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-semibold underline">Réessayer</button></p>}

        {loading && !data ? (
          <p className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-a-text-3" role="status"><IconLoader2 size={16} className="animate-spin" aria-hidden="true" /> Chargement…</p>
        ) : preorders.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-semibold text-a-text">{view === 'to_treat' ? 'Rien à traiter pour le moment.' : 'Aucune précommande ici.'}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-a-text-3">Les achats WhatsApp, téléphone, Instagram ou en boutique saisis par l’équipe apparaissent ici jusqu’au paiement.</p>
            <Link href="/admin/orders/new" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-a-brand px-4 text-sm font-semibold text-a-on-brand">Nouvelle commande</Link>
          </div>
        ) : (
          <ul className={`divide-y divide-a-border ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {preorders.map((preorder, index) => {
              const header = grouped && (index === 0 || preorders[index - 1]!.group !== preorder.group);
              const finished = preorder.group === 'finished';
              return (
                <Fragment key={preorder.id}>
                  {header && <li className={`bg-a-surface-2 px-4 py-1.5 text-xs font-semibold ${preorder.group === 'to_verify' ? 'text-tone-warning-fg' : 'text-a-text-3'}`}>{PREORDER_GROUP_LABELS[preorder.group]}</li>}
                  {/* The whole row opens the preorder (stretched link on the reference); the buttons sit above it. */}
                  <li className="relative grid gap-2 px-4 py-3 hover:bg-a-hover sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/orders/precommandes/${preorder.id}`} className="font-mono text-sm font-semibold text-a-text after:absolute after:inset-0 hover:underline focus-visible:outline-2 focus-visible:outline-a-focus">
                          {preorder.reference}<span className="sr-only"> — ouvrir la précommande</span>
                        </Link>
                        <PreorderStatusBadge status={preorder.status} />
                        {preorder.hasActiveLink && <span className="inline-flex items-center gap-1 text-xs font-semibold text-tone-info-fg"><IconLink size={13} aria-hidden="true" /> Lien actif</span>}
                      </div>
                      <p className={`mt-1 truncate text-sm ${finished ? 'text-a-text-3' : 'text-a-text-2'}`}>
                        {preorder.fullName ?? preorder.phone ?? preorder.email ?? 'Client'}
                        <span className="text-a-text-3"> · {preorder.salesChannel ? SALES_CHANNEL_LABELS[preorder.salesChannel] : '—'} · {preorder.itemCount} art. · {preorder.fulfillmentType === 'pickup' ? 'Retrait' : 'Livraison'}</span>
                      </p>
                      {preorder.warning && <p className="mt-0.5 flex items-start gap-1 text-xs font-semibold text-tone-warning-fg"><IconAlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />{preorder.warning}</p>}
                      {preorder.context && <p className="mt-0.5 text-xs text-a-text-3">{preorder.context}</p>}
                    </div>
                    <span className="text-sm font-bold text-a-text sm:text-right">{formatPrice(preorder.total, currency)}</span>
                    {canManage && LIST_CANCELLABLE.has(preorder.group) ? (
                      <button type="button" onClick={() => setCancelTarget(preorder)}
                        className="relative z-10 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-tone-danger-fg hover:bg-tone-danger-bg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus sm:w-auto">
                        <IconX size={15} aria-hidden="true" /> Annuler<span className="sr-only"> la précommande {preorder.reference}</span>
                      </button>
                    ) : <span className="hidden sm:block" />}
                    <Link href={`/admin/orders/precommandes/${preorder.id}`}
                      className={`relative z-10 inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-a-focus sm:w-36 ${finished ? 'text-a-text-3 hover:bg-a-hover' : preorder.action.primary ? 'bg-a-brand text-a-on-brand hover:opacity-90' : 'border border-a-border bg-a-surface text-a-text-2 hover:bg-a-surface-2'}`}>
                      {preorder.action.label}<span className="sr-only"> — précommande {preorder.reference}</span>
                    </Link>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}

        {data && data.totalPages > 1 && (
          <nav aria-label="Pagination des précommandes" className="flex items-center justify-between gap-2 border-t border-a-border px-3 py-2.5 text-xs">
            <span className="text-a-text-3">Page {data.page} / {data.totalPages} · {data.total} précommande{data.total > 1 ? 's' : ''}</span>
            <span className="flex gap-1">
              <button type="button" disabled={data.page <= 1} onClick={() => navigate({ page: String(data.page - 1) })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-a-border px-2.5 font-semibold text-a-text-2 disabled:opacity-40"><IconChevronLeft size={14} aria-hidden="true" /> Précédent</button>
              <button type="button" disabled={data.page >= data.totalPages} onClick={() => navigate({ page: String(data.page + 1) })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-a-border px-2.5 font-semibold text-a-text-2 disabled:opacity-40">Suivant <IconChevronRight size={14} aria-hidden="true" /></button>
            </span>
          </nav>
        )}
      </section>

      <ConfirmDialog
        open={cancelTarget !== null}
        title={`Annuler la précommande ${cancelTarget?.reference ?? ''} ?`}
        description="Le client ne pourra plus payer avec son lien et aucune commande ne sera créée. Elle reste consultable dans « Annulées ». Cette action est définitive."
        confirmLabel="Annuler la précommande"
        cancelLabel="Garder"
        destructive
        loading={cancelling}
        reason={{ label: 'Motif (facultatif)', placeholder: 'Ex. pas de réponse du client', maxLength: 300 }}
        onConfirm={cancelPreorder}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}
