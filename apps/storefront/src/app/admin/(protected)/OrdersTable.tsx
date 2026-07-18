'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconSearch,
  IconX,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconPrinter,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import StatusBadge from '../_components/ui/StatusBadge';
import BulkTrackingModal, { type PendingTrackingOrder } from '../_components/ui/BulkTrackingModal';
import AdminOrdersPoller from './AdminOrdersPoller';
import type { OrderStatus } from '@lepefy/types';

// ─── Local types ──────────────────────────────────────────────────────────────

interface ShippingAddress {
  city?:        string;
  postal_code?: string;
  country?:     string;
}

interface ShippingDetails {
  carrierName?: string;
  numParcels?:  number;
}

export interface OrderItemRow {
  id:           string;
  name:         string;
  quantity:     number;
  subtotal:     number;
  storage_type: string | null;
}

export interface ListOrder {
  id:               string;
  created_at:       string;
  full_name:        string | null;
  email:            string;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  shipping_details: ShippingDetails | null;
  subtotal:         number;
  shipping_cost:    number;
  total:            number;
  payment_method:   string | null;
  payment_status:   string;
  status:           OrderStatus;
  order_items:      OrderItemRow[];
}

// ─── SVG Flags ────────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  FR: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
  BE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#000"/><rect x="1" width="1" height="2" fill="#FAE042"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
  DE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 3"><rect width="5" height="3" fill="#FFCE00"/><rect width="5" height="2" fill="#000"/><rect width="5" height="1" fill="#DD0000"/></svg>`,
  CH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#FF0000"/><rect x="13" y="6" width="6" height="20" fill="#fff"/><rect x="6" y="13" width="20" height="6" fill="#fff"/></svg>`,
  LU: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#EF3340"/><rect y="0.667" width="3" height="0.666" fill="#fff"/><rect y="1.333" width="3" height="0.667" fill="#00A3E0"/></svg>`,
  NL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AE1C28"/><rect y="0.667" width="3" height="0.666" fill="#fff"/><rect y="1.333" width="3" height="0.667" fill="#21468B"/></svg>`,
  ES: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AA151B"/><rect y="0.5" width="3" height="1" fill="#F1BF00"/></svg>`,
  PT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#FF0000"/><rect width="1.2" height="2" fill="#006600"/></svg>`,
};

function FlagBadge({ country }: { country: string }) {
  const svg = FLAGS[country.toUpperCase()];
  if (!svg) return <span className="text-xs text-gray-500 dark:text-gray-400">{country}</span>;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold
                 bg-amber-50 text-amber-800 border border-amber-200
                 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800"
    >
      <span
        className="inline-block w-4 h-3 rounded-sm overflow-hidden"
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ lineHeight: 0 }}
      />
      {country.toUpperCase()}
    </span>
  );
}

// ─── DestinationCell ──────────────────────────────────────────────────────────

function DestinationCell({
  fulfillmentType,
  shippingAddress,
}: {
  fulfillmentType: string;
  shippingAddress: ShippingAddress | null;
}) {
  if (fulfillmentType === 'pickup') {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold
                   bg-blue-50 text-blue-800 border border-blue-200
                   dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800"
      >
        🏪 C&amp;C
      </span>
    );
  }
  if (!shippingAddress) return <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>;

  const country = shippingAddress.country ?? '';
  const isIT    = country.toUpperCase() === 'IT' || country === '';

  if (isIT) {
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {shippingAddress.postal_code && (
          <span className="font-mono">{shippingAddress.postal_code}</span>
        )}
        {shippingAddress.city && <span className="ml-1">{shippingAddress.city}</span>}
      </span>
    );
  }

  return <FlagBadge country={country} />;
}

// ─── PaymentBadge ─────────────────────────────────────────────────────────────

const PAYMENT_CONFIG: Record<string, { label: string; icon: string; className: string }> = {
  stripe: {
    label:     'Carte',
    icon:      '💳',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  },
  satispay: {
    label:     'Satispay',
    icon:      '🟠',
    className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  },
  in_store: {
    label:     'En magasin',
    icon:      '🏪',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  },
  cash: {
    label:     'Espèces',
    icon:      '💶',
    className: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  },
};

function PaymentBadge({ method }: { method: string | null }) {
  if (!method) return <span className="text-gray-400 dark:text-gray-500 text-xs">—</span>;

  const cfg = PAYMENT_CONFIG[method] ?? {
    label:     method,
    icon:      '💶',
    className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
  };

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cfg.className}`}>
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

// ─── OrdersTable ──────────────────────────────────────────────────────────────

interface OrdersTableProps {
  orders:         ListOrder[];
  tenantCurrency: string;
  carriers:       string[];
}

export default function OrdersTable({ orders, tenantCurrency, carriers }: OrdersTableProps) {
  const router = useRouter();

  const [searchQuery, setSearchQuery]     = useState('');
  const [expandedRows, setExpandedRows]   = useState<Set<string>>(new Set());
  const [sortBy, setSortBy]               = useState<'date' | 'total' | null>(null);
  const [sortDir, setSortDir]             = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [toast, setToast]                 = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);

  // Reset selezione quando cambia la ricerca testuale — altrimenti si
  // rischia di agire su ordini non più visibili. (Sui filtri di
  // AdminFilters il reset avviene già gratis: cambiano i searchParams,
  // la pagina server rifà il fetch e OrdersTable viene rimontato.)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [searchQuery]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  function toggleRow(orderId: string) {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });
  }

  function toggleSort(col: 'date' | 'total') {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setSortDir('desc');
    }
  }

  function ariaSort(col: 'date' | 'total'): 'ascending' | 'descending' | 'none' {
    if (sortBy !== col) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  const filteredOrders = searchQuery.trim()
    ? orders.filter(o => {
        const q = searchQuery.toLowerCase();
        return (
          (o.full_name ?? '').toLowerCase().includes(q) ||
          (o.email     ?? '').toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q)                ||
          o.id.slice(0, 8).toLowerCase().includes(q)
        );
      })
    : orders;

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    if (!sortBy) return 0;
    const mult = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'date')  return mult * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    if (sortBy === 'total') return mult * (a.total - b.total);
    return 0;
  });

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev =>
      prev.size === sortedOrders.length ? new Set() : new Set(sortedOrders.map(o => o.id))
    );
  }

  function handleExportCsv() {
    const rows = sortedOrders.filter(o => selectedIds.has(o.id));
    const header = ['Commande', 'Date', 'Client', 'Email', 'Total', 'Statut', 'Paiement', 'Transporteur'];
    const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;

    const lines = rows.map(o => [
      o.id.slice(0, 8).toUpperCase(),
      new Date(o.created_at).toLocaleDateString('fr-FR'),
      o.full_name ?? '',
      o.email,
      formatPrice(o.total, tenantCurrency),
      o.status,
      o.payment_method ?? '',
      o.shipping_details?.carrierName ?? '',
    ].map(v => csvEscape(String(v))).join(','));

    const csv = [header.map(csvEscape).join(','), ...lines].join('\r\n');
    // BOM per far riconoscere l'UTF-8 a Excel su Windows (accenti francesi)
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `commandes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrintPickingLists() {
    const ids = Array.from(selectedIds).join(',');
    window.open(`/admin/orders/picking-list?ids=${ids}`, '_blank', 'noopener,noreferrer');
  }

  async function handleMarkShipped(tracking?: Record<string, { carrier: string; code: string }>) {
    const ids = tracking ? Object.keys(tracking) : Array.from(selectedIds);
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

    const { shipped, readyForPickup, skipped } = await res.json();
    const missingTracking = skipped.filter((s: { reason: string }) => s.reason === 'missing_tracking');
    const wrongStatus     = skipped.filter((s: { reason: string }) => s.reason === 'wrong_status');

    if (missingTracking.length > 0 && !tracking) {
      // Primo giro: apri il pannello solo per chi manca ancora il tracking
      setPendingTracking(missingTracking.map((s: { id: string }) => {
        const order = orders.find(o => o.id === s.id);
        return {
          id:    s.id,
          label: `#${s.id.slice(0, 8).toUpperCase()} — ${order?.full_name ?? order?.email ?? ''}`,
        };
      }));
    } else {
      setPendingTracking(null);
    }

    // Le risolte escono dalla selezione; quelle bloccate per statuto sbagliato
    // restano selezionate; quelle in attesa di tracking restano selezionate
    // finché il pannello non si chiude con successo o annullamento.
    setSelectedIds(new Set([...wrongStatus.map((s: { id: string }) => s.id), ...missingTracking.map((s: { id: string }) => s.id)]));

    const parts: string[] = [];
    if (shipped.length)             parts.push(`${shipped.length} expédiée${shipped.length > 1 ? 's' : ''}`);
    if (readyForPickup.length)      parts.push(`${readyForPickup.length} prête${readyForPickup.length > 1 ? 's' : ''} (retrait)`);
    if (missingTracking.length && tracking) parts.push(`${missingTracking.length} ignorée${missingTracking.length > 1 ? 's' : ''} (code de suivi manquant)`);
    if (wrongStatus.length)         parts.push(`${wrongStatus.length} ignorée${wrongStatus.length > 1 ? 's' : ''} (statut incompatible)`);

    if (parts.length) {
      setToast({
        msg:  parts.join(' · '),
        type: shipped.length === 0 && readyForPickup.length === 0 ? 'error' : 'success',
      });
    }

    router.refresh(); // la pagina server rilegge gli ordini aggiornati
  }

  const handleNewOrders = useCallback((newOrders: { id: string }[]) => {
    if (newOrders.length === 0) return;

    if (newOrders.length === 1) {
      setToast({ msg: `Nouvelle commande #${newOrders[0].id.slice(0, 8).toUpperCase()}`, type: 'success' });
    } else {
      setToast({ msg: `${newOrders.length} nouvelles commandes`, type: 'success' });
    }

    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Nouvelle commande', {
        body: `Commande #${newOrders[0].id.slice(0, 8).toUpperCase()}`,
        tag:  'lepefy-new-order',
      });
    }
  }, []);

  return (
    <div>

      {/* ── Polling live (Fase 4) — sospeso in background, non forza il refresh
           mentre il pannello tracking della Fase 3 è aperto ──────────────────── */}
      <AdminOrdersPoller onNewOrders={handleNewOrders} isEditing={pendingTracking !== null} />

      {/* ── Search bar + contatore ──────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <IconSearch
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Client, email ou n° commande..."
            className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200
                       dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900
                       text-gray-900 dark:text-gray-100 focus:outline-none
                       focus:ring-2 focus:ring-[var(--color-primary)]
                       focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2
                         p-1.5 -m-1.5 text-gray-400 hover:text-gray-600
                         dark:text-gray-500 dark:hover:text-gray-300"
              aria-label="Effacer"
            >
              <IconX size={13} />
            </button>
          )}
        </div>

        {searchQuery && (
          <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
            {filteredOrders.length} résultat
            {filteredOrders.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Tabella ─────────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
        {sortedOrders.length === 0 ? (
          <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-12">
            {searchQuery
              ? `Aucune commande pour « ${searchQuery} »`
              : 'Aucune commande.'
            }
          </p>
        ) : (
          <>
          {/* ── Desktop / tablet ≥ md: tabella ──────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800 text-xs
                               font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th scope="col" className="w-8 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === sortedOrders.length}
                      ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedOrders.length; }}
                      onChange={toggleSelectAll}
                      aria-label="Sélectionner toutes les commandes"
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </th>
                  <th scope="col" className="w-8 px-3 py-3">
                    <span className="sr-only">Développer</span>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left" aria-sort={ariaSort('date')}>
                    <button
                      onClick={() => toggleSort('date')}
                      className="flex items-center gap-1 uppercase tracking-wide
                                 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      Commande
                      {sortBy === 'date' && (sortDir === 'asc'
                        ? <IconChevronUp size={12} />
                        : <IconChevronDown size={12} />)}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">Produits</th>
                  <th scope="col" className="px-4 py-3 text-left">Destination</th>
                  <th scope="col" className="px-4 py-3 text-left" aria-sort={ariaSort('total')}>
                    <button
                      onClick={() => toggleSort('total')}
                      className="flex items-center gap-1 uppercase tracking-wide
                                 hover:text-gray-700 dark:hover:text-gray-200"
                    >
                      Montant
                      {sortBy === 'total' && (sortDir === 'asc'
                        ? <IconChevronUp size={12} />
                        : <IconChevronDown size={12} />)}
                    </button>
                  </th>
                  <th scope="col" className="px-4 py-3 text-left">Statut</th>
                  <th scope="col" className="hidden lg:table-cell px-4 py-3 text-left">Paiement</th>
                  <th scope="col" className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedOrders.map(order => {
                  const isExpanded   = expandedRows.has(order.id);
                  const items        = order.order_items ?? [];
                  const visibleItems = items.slice(0, 2);
                  const hiddenCount  = Math.max(0, items.length - 2);
                  const isToday      = new Date(order.created_at).toDateString() === new Date().toDateString();

                  return (
                    <Fragment key={order.id}>

                      {/* ── Riga principale ──────────────────────────────── */}
                      <tr className={`border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors${isExpanded ? ' bg-gray-50/60 dark:bg-gray-800/60' : ''}`}>

                        {/* Checkbox selezione */}
                        <td className="px-3 py-3 w-8">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(order.id)}
                            onChange={() => toggleSelect(order.id)}
                            aria-label={`Sélectionner la commande #${order.id.slice(0, 8).toUpperCase()}`}
                            className="rounded border-gray-300 dark:border-gray-600"
                          />
                        </td>

                        {/* Freccia espansione */}
                        <td className="px-3 py-3 w-8">
                          {items.length > 0 && (
                            <button
                              onClick={() => toggleRow(order.id)}
                              className="p-2 rounded text-gray-400 dark:text-gray-500
                                         hover:text-gray-600 dark:hover:text-gray-300
                                         hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                              aria-label={isExpanded ? 'Réduire' : 'Développer'}
                              aria-expanded={isExpanded}
                            >
                              {isExpanded
                                ? <IconChevronDown size={14} stroke={2} />
                                : <IconChevronRight size={14} stroke={1.5} />
                              }
                            </button>
                          )}
                        </td>

                        {/* Commande + Client */}
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                            #{order.id.slice(0, 8).toUpperCase()}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {new Date(order.created_at).toLocaleDateString('fr-FR', {
                              day: '2-digit', month: '2-digit',
                            })}
                          </p>
                          {isToday && (
                            <span className="text-xs font-medium bg-yellow-50 text-yellow-700
                                             dark:bg-yellow-950 dark:text-yellow-300
                                             px-1.5 py-0.5 rounded mt-0.5 inline-block">
                              Aujourd&apos;hui
                            </span>
                          )}
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug mt-1 truncate max-w-[160px]">
                            {order.full_name ?? '—'}
                          </p>
                        </td>

                        {/* Produits — max 2 + contatore */}
                        <td className="px-4 py-3 max-w-[200px]">
                          <div className="space-y-1">
                            {visibleItems.map((item, idx) => (
                              <div key={item.id ?? idx} className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400
                                                 bg-gray-100 dark:bg-gray-800 rounded px-1.5 py-0.5 flex-shrink-0">
                                  ×{item.quantity}
                                </span>
                                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                                  {item.name}
                                </span>
                                {item.storage_type === 'frozen' && (
                                  <span className="text-[10px]" title="Surgelé" aria-label="Surgelé" role="img">❄</span>
                                )}
                                {item.storage_type === 'fresh' && (
                                  <span className="text-[10px]" title="Frais" aria-label="Frais" role="img">🌿</span>
                                )}
                              </div>
                            ))}
                            {hiddenCount > 0 && !isExpanded && (
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                                + {hiddenCount} autre{hiddenCount > 1 ? 's' : ''}{' '}
                                <span className="text-gray-500 dark:text-gray-400">(↑ développer)</span>
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Destination */}
                        <td className="px-4 py-3">
                          <DestinationCell
                            fulfillmentType={order.fulfillment_type}
                            shippingAddress={order.shipping_address}
                          />
                        </td>

                        {/* Montant (+ Transporteur) */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="font-semibold text-gray-900 dark:text-gray-100">
                            {formatPrice(order.total, tenantCurrency)}
                          </span>
                          {order.shipping_details?.carrierName && (
                            <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">
                              {order.shipping_details.carrierName}
                              {order.shipping_details.numParcels != null && order.shipping_details.numParcels > 1
                                ? ` · ${order.shipping_details.numParcels} colis`
                                : ''}
                            </span>
                          )}
                        </td>

                        {/* Statut */}
                        <td className="px-4 py-3">
                          <StatusBadge status={order.status} />
                        </td>

                        {/* Paiement — secondaria, visibile solo ≥ lg */}
                        <td className="hidden lg:table-cell px-4 py-3">
                          <PaymentBadge method={order.payment_method} />
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/admin/orders/${order.id}/picking-list`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-gray-400 hover:text-gray-600
                                         dark:text-gray-500 dark:hover:text-gray-300
                                         hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
                              title="Liste de préparation"
                              aria-label="Imprimer la liste de préparation"
                            >
                              <IconPrinter size={15} />
                            </Link>
                            <Link
                              href={`/admin/orders/${order.id}`}
                              className="text-xs font-medium px-3 py-1.5 rounded-lg
                                         border border-gray-200 dark:border-gray-700
                                         text-gray-700 dark:text-gray-300
                                         hover:bg-gray-50 dark:hover:bg-gray-800
                                         transition-colors whitespace-nowrap"
                            >
                              Voir →
                            </Link>
                          </div>
                        </td>
                      </tr>

                      {/* ── Pannello espanso ─────────────────────────────── */}
                      {isExpanded && (
                        <tr key={`${order.id}-detail`}>
                          <td />
                          <td colSpan={8} className="px-4 pb-4 pt-1">
                            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800
                                            overflow-hidden shadow-sm">

                              <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-800
                                              bg-gray-50 dark:bg-gray-800 flex items-center justify-between">
                                <span className="text-xs font-medium text-gray-500 dark:text-gray-400
                                                 uppercase tracking-wide">
                                  Détail de la commande
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {items.length} article{items.length > 1 ? 's' : ''}
                                </span>
                              </div>

                              {/* Dati non più visibili nella riga principale */}
                              <div className="px-4 py-2.5 border-b border-gray-50 dark:border-gray-800
                                              flex flex-wrap items-center gap-x-6 gap-y-1
                                              text-xs text-gray-500 dark:text-gray-400">
                                <span>{order.email}</span>
                                <span className="lg:hidden"><PaymentBadge method={order.payment_method} /></span>
                              </div>

                              <div className="divide-y divide-gray-50 dark:divide-gray-800">
                                {items.map((item, idx) => (
                                  <div
                                    key={item.id ?? idx}
                                    className="flex items-center justify-between px-4 py-2.5"
                                  >
                                    <div className="flex items-center gap-3">
                                      <span className="text-xs font-semibold
                                                       text-[var(--color-primary)]
                                                       bg-[var(--color-primary-light)]
                                                       rounded px-2 py-0.5 flex-shrink-0">
                                        ×{item.quantity}
                                      </span>
                                      <span className="text-sm text-gray-800 dark:text-gray-200">{item.name}</span>
                                      {item.storage_type === 'frozen' && (
                                        <span className="text-xs" title="Surgelé" aria-label="Surgelé" role="img">❄</span>
                                      )}
                                      {item.storage_type === 'fresh' && (
                                        <span className="text-xs" title="Frais" aria-label="Frais" role="img">🌿</span>
                                      )}
                                    </div>
                                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300
                                                     flex-shrink-0 ml-4">
                                      {formatPrice(item.subtotal, tenantCurrency)}
                                    </span>
                                  </div>
                                ))}
                              </div>

                              <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-800
                                              bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                                <span className="text-xs text-gray-500 dark:text-gray-400">Total commande</span>
                                <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                                  {formatPrice(order.total, tenantCurrency)}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}

                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Mobile < md: card list, tap-through al dettaglio ────────────── */}
          <ul className="md:hidden divide-y divide-gray-100 dark:divide-gray-800" role="list" aria-label="Commandes">
            {sortedOrders.map(order => (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className="flex items-start gap-3 p-4 active:bg-gray-50 dark:active:bg-gray-800"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-medium text-gray-600 dark:text-gray-300">
                        #{order.id.slice(0, 8).toUpperCase()}
                      </span>
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mt-1 truncate">
                      {order.full_name ?? '—'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {(order.order_items ?? []).length} article{(order.order_items ?? []).length > 1 ? 's' : ''}
                      {' · '}
                      {new Date(order.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                    </p>
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-1">
                      {formatPrice(order.total, tenantCurrency)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      {/* ── Bulk bar — visibile solo con ≥1 selezione ───────────────────────── */}
      {selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="Actions groupées"
          className="sticky bottom-4 z-20 mx-auto max-w-fit flex items-center gap-3
                     bg-gray-900 dark:bg-gray-800 text-white rounded-full
                     shadow-lg px-4 py-2.5 mt-4"
        >
          <span className="text-sm font-medium">
            {selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}
          </span>
          <div className="h-4 w-px bg-white/20" />
          <button onClick={handleExportCsv} className="text-sm hover:opacity-80 transition-opacity">
            Exporter CSV
          </button>
          <button onClick={handlePrintPickingLists} className="text-sm hover:opacity-80 transition-opacity">
            Imprimer les listes
          </button>
          <button onClick={() => handleMarkShipped()} className="text-sm hover:opacity-80 transition-opacity">
            Traiter la sélection
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            aria-label="Annuler la sélection"
            className="ml-1 p-1 hover:bg-white/10 rounded-full"
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* ── Pannello tracking — apre quando il primo giro segnala ordini senza
           codice di spedizione, invece di limitarsi a saltarli ─────────────── */}
      {pendingTracking && (
        <BulkTrackingModal
          orders={pendingTracking}
          carrierOptions={carriers}
          onCancel={() => setPendingTracking(null)}
          onConfirm={(tracking) => {
            handleMarkShipped(tracking);
          }}
        />
      )}

      {/* ── Toast — stesso pattern dei client etichette ─────────────────────── */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
            toast.type === 'success' ? 'bg-[var(--color-primary)]' : 'bg-red-500'
          }`}
        >
          {toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
