'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconLink, IconLoader2, IconSearch } from '@tabler/icons-react';
import { SALES_CHANNEL_LABELS } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import { PREORDER_GROUP_LABELS, parsePreorderView, type PreorderView } from '@/lib/orders/assisted/preorderQueue';
import type { PreorderQueueResult } from '@/lib/orders/assisted/loadPreorderQueue';
import PreorderStatusBadge from '../_assisted/PreorderStatusBadge';

const KPI_CARDS: Array<{ group: keyof PreorderQueueResult['kpis']; label: string; helper: string; tone: string }> = [
  { group: 'to_verify', label: 'À vérifier', helper: 'Paiement déclaré par le client', tone: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' },
  { group: 'expired', label: 'Liens expirés', helper: 'Nouveau lien ou annulation', tone: 'border-orange-200 bg-orange-50/70 dark:border-orange-900 dark:bg-orange-950/20' },
  { group: 'draft', label: 'Brouillons', helper: 'À compléter et envoyer', tone: 'border-gray-200 bg-gray-50/70 dark:border-gray-700 dark:bg-gray-950/40' },
  { group: 'waiting', label: 'Attente client', helper: 'Lien envoyé, paiement attendu', tone: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20' },
];

export default function PreordersListClient({ currency }: { currency: string }) {
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
  const grouped = view === 'to_treat' || view === 'waiting' || view === 'all';

  return (
    <div className="space-y-4">
      <section aria-label="File des précommandes" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {KPI_CARDS.map((card) => {
          const target: PreorderView = card.group === 'waiting' ? 'waiting' : 'to_treat';
          const count = data?.kpis[card.group] ?? 0;
          return (
            <Link key={card.group} href={target === 'to_treat' ? pathname : `${pathname}?view=${target}`}
              className={`min-h-[76px] rounded-xl border p-3 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] ${card.tone}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{card.label}</p>
                <span className={`min-w-8 rounded-full px-2 py-0.5 text-center text-sm font-bold ${count > 0 ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'}`}>{data ? count : '…'}</span>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-gray-500 dark:text-gray-400">{card.helper}</p>
            </Link>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-2 border-b border-[var(--admin-border)] p-2 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Vues des précommandes">
            {tabs.map((tab) => {
              const active = view === tab.key;
              return (
                <button key={tab.key} type="button" aria-current={active ? 'page' : undefined} onClick={() => navigate({ view: tab.key })}
                  className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] ${active ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]' : 'text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:text-gray-300'}`}>
                  {tab.label}
                  {tab.count !== undefined && <span className="min-w-5 rounded-full bg-gray-100 px-1.5 py-0.5 text-center text-[10px] dark:bg-gray-800">{tab.count}</span>}
                </button>
              );
            })}
          </nav>
          <div className="relative w-full lg:max-w-xs">
            <IconSearch size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client, téléphone, e-mail ou P-…" aria-label="Rechercher une précommande"
              className="h-10 w-full rounded-xl border border-[var(--admin-border)] bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950" />
          </div>
        </div>

        {data && !data.complete && <p role="status" className="m-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Plus de 1 000 précommandes actives : les compteurs sont partiels.</p>}
        {error && <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error} <button type="button" onClick={() => setReloadKey((key) => key + 1)} className="font-semibold underline">Réessayer</button></p>}

        {loading && !data ? (
          <p className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-gray-500" role="status"><IconLoader2 size={16} className="animate-spin" aria-hidden="true" /> Chargement…</p>
        ) : preorders.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <p className="font-semibold text-gray-800 dark:text-gray-100">{view === 'to_treat' ? 'Rien à traiter pour le moment.' : 'Aucune précommande ici.'}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">Les achats WhatsApp, téléphone, Instagram ou en boutique saisis par l’équipe apparaissent ici jusqu’au paiement.</p>
            <Link href="/admin/orders/new" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white">Nouvelle commande</Link>
          </div>
        ) : (
          <ul className={`divide-y divide-[var(--admin-border)] dark:divide-gray-800 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
            {preorders.map((preorder, index) => {
              const header = grouped && (index === 0 || preorders[index - 1]!.group !== preorder.group);
              const finished = preorder.group === 'finished';
              return (
                <Fragment key={preorder.id}>
                  {header && <li className={`bg-gray-50/80 px-4 py-1.5 text-[11px] font-semibold dark:bg-gray-800/50 ${preorder.group === 'to_verify' ? 'text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>{PREORDER_GROUP_LABELS[preorder.group]}</li>}
                  <li className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{preorder.reference}</span>
                        <PreorderStatusBadge status={preorder.status} />
                        {preorder.hasActiveLink && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 dark:text-sky-300"><IconLink size={13} aria-hidden="true" /> Lien actif</span>}
                      </div>
                      <p className={`mt-1 truncate text-sm ${finished ? 'text-gray-500' : 'text-gray-700 dark:text-gray-200'}`}>
                        {preorder.fullName ?? preorder.phone ?? preorder.email ?? 'Client'}
                        <span className="text-gray-400"> · {preorder.salesChannel ? SALES_CHANNEL_LABELS[preorder.salesChannel] : '—'} · {preorder.itemCount} art. · {preorder.fulfillmentType === 'pickup' ? 'Retrait' : 'Livraison'}</span>
                      </p>
                      {preorder.warning && <p className="mt-0.5 flex items-start gap-1 text-xs font-semibold text-amber-800 dark:text-amber-300"><IconAlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />{preorder.warning}</p>}
                      {preorder.context && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{preorder.context}</p>}
                    </div>
                    <span className="text-sm font-bold text-gray-950 dark:text-gray-100 sm:text-right">{formatPrice(preorder.total, currency)}</span>
                    <Link href={`/admin/orders/precommandes/${preorder.id}`}
                      className={`inline-flex min-h-11 w-full items-center justify-center rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-primary)] sm:w-36 ${finished ? 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800' : preorder.action.primary ? 'bg-[var(--admin-primary)] text-white hover:opacity-90' : 'border border-[var(--admin-border)] bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200'}`}>
                      {preorder.action.label}<span className="sr-only"> — précommande {preorder.reference}</span>
                    </Link>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        )}

        {data && data.totalPages > 1 && (
          <nav aria-label="Pagination des précommandes" className="flex items-center justify-between gap-2 border-t border-[var(--admin-border)] px-3 py-2.5 text-xs dark:border-gray-800">
            <span className="text-gray-500">Page {data.page} / {data.totalPages} · {data.total} précommande{data.total > 1 ? 's' : ''}</span>
            <span className="flex gap-1">
              <button type="button" disabled={data.page <= 1} onClick={() => navigate({ page: String(data.page - 1) })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 font-semibold text-gray-600 disabled:opacity-40 dark:text-gray-300"><IconChevronLeft size={14} aria-hidden="true" /> Précédent</button>
              <button type="button" disabled={data.page >= data.totalPages} onClick={() => navigate({ page: String(data.page + 1) })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 font-semibold text-gray-600 disabled:opacity-40 dark:text-gray-300">Suivant <IconChevronRight size={14} aria-hidden="true" /></button>
            </span>
          </nav>
        )}
      </section>
    </div>
  );
}
