'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
  IconMapPin,
  IconPackage,
  IconPrinter,
  IconShoppingBag,
  IconTruck,
  IconX,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import StatusBadge from '../_components/ui/StatusBadge';
import BulkTrackingModal, { type PendingTrackingOrder } from '../_components/ui/BulkTrackingModal';
import AdminOrdersPoller from './AdminOrdersPoller';
import type { OrderStatus } from '@lepefy/types';

interface ShippingAddress {
  city?: string;
  postal_code?: string;
  country?: string;
}

interface ShippingDetails {
  carrierName?: string;
  numParcels?: number;
}

export interface WorkQueueItem {
  id: string;
  created_at: string;
  full_name: string | null;
  email: string;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  shipping_details: ShippingDetails | null;
  tracking_code: string | null;
  subtotal: number;
  shipping_cost: number;
  total: number;
  payment_method: string | null;
  payment_status: string;
  status: OrderStatus;
  order_items: Array<{
    id: string;
    name: string;
    quantity: number;
    subtotal: number;
    storage_type: string | null;
  }>;
}

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Carte',
  satispay: 'Satispay',
  in_store: 'En magasin',
  cash: 'Espèces',
  external_link: 'Lien externe',
};

function PaymentChip({ method, status }: { method: string | null; status: string }) {
  const label = method ? (PAYMENT_LABELS[method] ?? method) : '—';
  const pending = status === 'pending';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
      pending
        ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
    }`}>
      {label}
      {pending && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
    </span>
  );
}

function Fulfillment({ order }: { order: WorkQueueItem }) {
  if (order.fulfillment_type === 'pickup') {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
          <IconShoppingBag size={15} />
        </span>
        <div>
          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">Click & Collect</p>
          <p className="mt-0.5 text-[11px] text-gray-400">Retrait en boutique</p>
        </div>
      </div>
    );
  }

  const city = [order.shipping_address?.postal_code, order.shipping_address?.city].filter(Boolean).join(' ');
  const country = order.shipping_address?.country?.toUpperCase();
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
        <IconMapPin size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{city || 'Livraison'}</p>
        <p className="mt-0.5 truncate text-[11px] text-gray-400">
          {[country, order.shipping_details?.carrierName].filter(Boolean).join(' · ') || 'Adresse de livraison'}
        </p>
      </div>
    </div>
  );
}

interface Props {
  orders: WorkQueueItem[];
  tenantCurrency: string;
  carriers: string[];
}

export default function OrdersWorkQueue({ orders, tenantCurrency, carriers }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleNewOrders = useCallback((newOrders: { id: string }[]) => {
    if (!newOrders[0]) return;
    setToast({
      msg: newOrders.length === 1
        ? `Nouvelle commande #${newOrders[0].id.slice(0, 8).toUpperCase()}`
        : `${newOrders.length} nouvelles commandes`,
      type: 'success',
    });
  }, []);

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev => prev.size === orders.length ? new Set() : new Set(orders.map(order => order.id)));
  }

  function exportCsv() {
    const rows = orders.filter(order => selected.has(order.id));
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const header = ['Commande', 'Date', 'Client', 'Email', 'Total', 'Statut', 'Paiement'];
    const lines = rows.map(order => [
      order.id.slice(0, 8).toUpperCase(),
      new Date(order.created_at).toLocaleDateString('fr-FR'),
      order.full_name ?? '',
      order.email,
      formatPrice(order.total, tenantCurrency),
      order.status,
      order.payment_method ?? '',
    ].map(value => escape(String(value))).join(','));
    const blob = new Blob(['\uFEFF' + [header.map(escape).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commandes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function processSelection(tracking?: Record<string, { carrier: string; code: string }>) {
    const ids = tracking ? Object.keys(tracking) : Array.from(selected);
    const res = await fetch('/api/admin/orders/bulk-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: ids, tracking }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setToast({ msg: body?.error ?? 'Erreur lors de la mise à jour.', type: 'error' });
      return;
    }
    const body = await res.json();
    const missing = body.skipped.filter((item: { reason: string }) => item.reason === 'missing_tracking');
    const wrong = body.skipped.filter((item: { reason: string }) => item.reason === 'wrong_status');

    if (missing.length && !tracking) {
      setPendingTracking(missing.map((item: { id: string }) => {
        const order = orders.find(candidate => candidate.id === item.id);
        return { id: item.id, label: `#${item.id.slice(0, 8).toUpperCase()} — ${order?.full_name ?? order?.email ?? ''}` };
      }));
    } else {
      setPendingTracking(null);
    }

    setSelected(new Set([...wrong.map((item: { id: string }) => item.id), ...missing.map((item: { id: string }) => item.id)]));
    const changed = body.shipped.length + body.readyForPickup.length;
    setToast({
      msg: changed ? `${changed} commande${changed > 1 ? 's' : ''} traitée${changed > 1 ? 's' : ''}` : 'Aucune commande modifiée',
      type: changed ? 'success' : 'error',
    });
    router.refresh();
  }

  if (!orders.length) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-14 text-center dark:border-gray-800 dark:bg-gray-900">
        <IconPackage className="mx-auto text-gray-300" size={28} />
        <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Aucune commande dans cette vue</p>
        <p className="mt-1 text-xs text-gray-400">Modifiez les filtres ou la recherche pour afficher d'autres commandes.</p>
      </div>
    );
  }

  return (
    <div>
      <AdminOrdersPoller onNewOrders={handleNewOrders} isEditing={pendingTracking !== null} />

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="hidden grid-cols-[38px_minmax(190px,1.35fr)_minmax(180px,1.1fr)_minmax(150px,.9fr)_100px_130px_120px_58px] items-center gap-3 border-b border-[var(--admin-border)] bg-[var(--admin-surface-subtle)] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-gray-400 dark:border-gray-800 dark:bg-gray-950 xl:grid">
          <div>
            <input
              type="checkbox"
              checked={selected.size > 0 && selected.size === orders.length}
              ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < orders.length; }}
              onChange={toggleAll}
              aria-label="Sélectionner toutes les commandes de cette page"
            />
          </div>
          <div>Commande / client</div>
          <div>Produits</div>
          <div>Fulfillment</div>
          <div className="text-right">Montant</div>
          <div>Statut</div>
          <div>Paiement</div>
          <div />
        </div>

        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {orders.map(order => {
            const isExpanded = expanded.has(order.id);
            const items = order.order_items ?? [];
            const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
            const primaryItem = items[0];
            const extraItems = Math.max(0, items.length - 1);
            const created = new Date(order.created_at);
            const isToday = created.toDateString() === new Date().toDateString();

            return (
              <Fragment key={order.id}>
                <div className={`group px-3 py-3 transition-colors hover:bg-gray-50/80 dark:hover:bg-gray-800/40 sm:px-4 ${isExpanded ? 'bg-gray-50/70 dark:bg-gray-800/40' : ''}`}>
                  <div className="grid gap-3 xl:grid-cols-[38px_minmax(190px,1.35fr)_minmax(180px,1.1fr)_minmax(150px,.9fr)_100px_130px_120px_58px] xl:items-center">
                    <div className="hidden xl:block">
                      <input
                        type="checkbox"
                        checked={selected.has(order.id)}
                        onChange={() => toggleSelected(order.id)}
                        aria-label={`Sélectionner la commande #${order.id.slice(0, 8).toUpperCase()}`}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-gray-500 dark:text-gray-400">#{order.id.slice(0, 8).toUpperCase()}</span>
                        <span className="text-[11px] text-gray-400">
                          {isToday ? "Aujourd'hui" : created.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                        </span>
                      </div>
                      <Link href={`/admin/orders/${order.id}`} className="mt-1 block truncate text-sm font-semibold text-gray-950 hover:text-[var(--admin-primary-fg)] dark:text-gray-50">
                        {order.full_name ?? order.email}
                      </Link>
                      <p className="mt-0.5 truncate text-[11px] text-gray-400">{order.email}</p>
                    </div>

                    <div className="min-w-0">
                      {primaryItem ? (
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">×{primaryItem.quantity}</span>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-gray-700 dark:text-gray-200">{primaryItem.name}</p>
                            <p className="mt-0.5 text-[11px] text-gray-400">
                              {quantity} article{quantity !== 1 ? 's' : ''}{extraItems ? ` · +${extraItems} référence${extraItems > 1 ? 's' : ''}` : ''}
                            </p>
                          </div>
                        </div>
                      ) : <span className="text-xs text-gray-400">Aucun article</span>}
                    </div>

                    <Fulfillment order={order} />

                    <div className="flex items-center justify-between xl:block xl:text-right">
                      <span className="text-[11px] font-semibold uppercase text-gray-400 xl:hidden">Montant</span>
                      <span className="text-sm font-bold tabular-nums text-gray-950 dark:text-gray-50">{formatPrice(order.total, tenantCurrency)}</span>
                    </div>

                    <div className="flex items-center justify-between xl:block">
                      <span className="text-[11px] font-semibold uppercase text-gray-400 xl:hidden">Statut</span>
                      <StatusBadge status={order.status} />
                    </div>

                    <div className="flex items-center justify-between xl:block">
                      <span className="text-[11px] font-semibold uppercase text-gray-400 xl:hidden">Paiement</span>
                      <PaymentChip method={order.payment_method} status={order.payment_status} />
                    </div>

                    <div className="flex items-center justify-end gap-1">
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setExpanded(prev => {
                            const next = new Set(prev);
                            next.has(order.id) ? next.delete(order.id) : next.add(order.id);
                            return next;
                          })}
                          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
                          aria-label={isExpanded ? 'Réduire les produits' : 'Afficher tous les produits'}
                        >
                          {isExpanded ? <IconChevronDown size={17} /> : <IconChevronRight size={17} />}
                        </button>
                      )}
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] transition hover:brightness-95"
                        aria-label={`Ouvrir la commande #${order.id.slice(0, 8).toUpperCase()}`}
                      >
                        <IconExternalLink size={16} />
                      </Link>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-gray-50/70 px-4 pb-4 dark:bg-gray-950/30">
                    <div className="ml-0 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900 xl:ml-[50px]">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Articles de la commande</p>
                        <Link href={`/admin/orders/${order.id}/picking-list`} target="_blank" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
                          <IconPrinter size={14} /> Liste de préparation
                        </Link>
                      </div>
                      <div className="divide-y divide-gray-100 dark:divide-gray-800">
                        {items.map(item => (
                          <div key={item.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                            <div className="min-w-0">
                              <span className="mr-2 rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-500 dark:bg-gray-800">×{item.quantity}</span>
                              <span className="text-gray-700 dark:text-gray-200">{item.name}</span>
                            </div>
                            <span className="shrink-0 font-semibold text-gray-600 dark:text-gray-300">{formatPrice(item.subtotal, tenantCurrency)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </div>

      {selected.size > 0 && (
        <div role="toolbar" aria-label="Actions groupées" className="sticky bottom-4 z-20 mx-auto mt-4 flex max-w-fit flex-wrap items-center justify-center gap-2 rounded-2xl bg-gray-950 px-3 py-2.5 text-white shadow-xl">
          <span className="px-1 text-xs font-semibold">{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
          <button onClick={exportCsv} className="rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-white/10">Exporter CSV</button>
          <button onClick={() => window.open(`/admin/orders/picking-list?ids=${Array.from(selected).join(',')}`, '_blank', 'noopener,noreferrer')} className="rounded-lg px-2.5 py-1.5 text-xs font-medium hover:bg-white/10">Imprimer</button>
          <button onClick={() => processSelection()} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs font-bold text-gray-950 hover:bg-gray-100">
            <IconTruck size={14} /> Traiter
          </button>
          <button onClick={() => setSelected(new Set())} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Annuler la sélection"><IconX size={14} /></button>
        </div>
      )}

      {pendingTracking && (
        <BulkTrackingModal
          orders={pendingTracking}
          carrierOptions={carriers}
          onCancel={() => setPendingTracking(null)}
          onConfirm={tracking => processSelection(tracking)}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-[var(--admin-primary)]' : 'bg-red-500'}`}>
          {toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
