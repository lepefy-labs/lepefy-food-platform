'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { IconLink, IconLoader2, IconSearch } from '@tabler/icons-react';
import type { CheckoutSessionStatus } from '@lepefy/types';
import { PREORDER_STATUS_LABELS, SALES_CHANNEL_LABELS } from '@lepefy/types';
import { formatPrice } from '@/lib/utils/format';
import PreorderStatusBadge from '../_assisted/PreorderStatusBadge';
import type { PreorderListItem } from '../_assisted/types';

type Tab = 'active' | CheckoutSessionStatus;

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'active', label: 'À traiter' },
  { key: 'draft', label: PREORDER_STATUS_LABELS.draft },
  { key: 'open', label: PREORDER_STATUS_LABELS.open },
  { key: 'awaiting_verification', label: PREORDER_STATUS_LABELS.awaiting_verification },
  { key: 'expired', label: PREORDER_STATUS_LABELS.expired },
  { key: 'completed', label: PREORDER_STATUS_LABELS.completed },
  { key: 'cancelled', label: PREORDER_STATUS_LABELS.cancelled },
];

function formatDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export default function PreordersListClient({ currency }: { currency: string }) {
  const [tab, setTab] = useState<Tab>('active');
  const [query, setQuery] = useState('');
  const [preorders, setPreorders] = useState<PreorderListItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: Tab, q: string) => {
    setError(null);
    try {
      const params = new URLSearchParams({ status });
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/admin/assisted-orders?${params.toString()}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null) as { preorders?: PreorderListItem[]; statusCounts?: Record<string, number>; error?: string } | null;
      if (!res.ok) { setError(body?.error ?? 'Chargement impossible.'); setPreorders([]); return; }
      setPreorders(body?.preorders ?? []);
      setCounts(body?.statusCounts ?? {});
    } catch {
      setError('Connexion impossible.');
      setPreorders([]);
    }
  }, []);

  useEffect(() => {
    setPreorders(null);
    const timer = window.setTimeout(() => { void load(tab, query); }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [tab, query, load]);

  const activeCount = (counts.draft ?? 0) + (counts.open ?? 0) + (counts.awaiting_verification ?? 0) + (counts.expired ?? 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] px-2 py-1.5 dark:border-gray-800" role="tablist" aria-label="Statuts des précommandes">
        {TABS.map((entry) => {
          const count = entry.key === 'active' ? activeCount : counts[entry.key] ?? 0;
          const active = tab === entry.key;
          return (
            <button
              key={entry.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(entry.key)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold ${active ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]' : 'text-gray-500 hover:bg-[var(--admin-surface-subtle)] dark:text-gray-400'}`}
            >
              {entry.label}<span className="min-w-5 rounded-full bg-gray-100 px-1.5 py-0.5 text-center text-[10px] dark:bg-gray-800">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="border-b border-[var(--admin-border)] p-3 dark:border-gray-800">
        <div className="relative max-w-md">
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Client, téléphone ou e-mail…" aria-label="Rechercher une précommande"
            className="h-10 w-full rounded-xl border border-[var(--admin-border)] bg-white pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950"
          />
        </div>
      </div>

      {error && <p className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}

      {preorders === null ? (
        <p className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-gray-500"><IconLoader2 size={16} className="animate-spin" /> Chargement…</p>
      ) : preorders.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="font-semibold text-gray-800 dark:text-gray-100">Aucune précommande ici.</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">Les achats WhatsApp, téléphone ou Instagram en attente de paiement apparaîtront dans cette liste.</p>
          <Link href="/admin/orders/new" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white">Nouvelle commande</Link>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--admin-border)] dark:divide-gray-800">
          {preorders.map((preorder) => (
            <li key={preorder.id}>
              <Link href={`/admin/orders/precommandes/${preorder.id}`} className="grid gap-2 px-4 py-3 hover:bg-[var(--admin-surface-subtle)] dark:hover:bg-gray-800/60 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900 dark:text-gray-100">{preorder.reference}</span>
                    <PreorderStatusBadge status={preorder.status} />
                    {preorder.hasActiveLink && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700"><IconLink size={13} /> Lien actif</span>}
                  </div>
                  <p className="mt-1 truncate text-sm text-gray-700 dark:text-gray-200">
                    {preorder.fullName ?? preorder.phone ?? preorder.email ?? 'Client'}
                    <span className="text-gray-400"> · {preorder.salesChannel ? SALES_CHANNEL_LABELS[preorder.salesChannel] : '—'} · {preorder.itemCount} article{preorder.itemCount > 1 ? 's' : ''}</span>
                  </p>
                  {preorder.declaredPayment && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">Paiement déclaré : {preorder.declaredPayment}</p>}
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end">
                  <span className="text-xs text-gray-400">{formatDate(preorder.createdAt)}</span>
                  <span className="text-sm font-bold text-gray-950 dark:text-gray-100">{formatPrice(preorder.total, currency)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
