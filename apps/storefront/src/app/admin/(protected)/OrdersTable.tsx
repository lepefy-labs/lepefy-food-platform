'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconClock,
  IconPrinter,
  IconSearch,
  IconSnowflake,
  IconTemperature,
  IconX,
} from '@tabler/icons-react';
import { formatPrice } from '@/lib/utils/format';
import StatusBadge from '../_components/ui/StatusBadge';
import Button from '../_components/ui/Button';
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

export interface OrderItemRow {
  id: string;
  name: string;
  quantity: number;
  subtotal: number;
  storage_type: string | null;
  warehouse_location?: string | null;
}

export interface ListOrder {
  id: string;
  created_at: string;
  full_name: string | null;
  email: string;
  fulfillment_type: 'delivery' | 'pickup';
  shipping_address: ShippingAddress | null;
  shipping_details: ShippingDetails | null;
  subtotal: number;
  shipping_cost: number;
  total: number;
  payment_method: string | null;
  payment_status: string;
  status: OrderStatus;
  order_items: OrderItemRow[];
}

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

const PAYMENT_CONFIG: Record<string, { label: string; icon: string; className: string }> = {
  stripe: { label: 'Carte', icon: '💳', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200' },
  external_link: { label: 'Externe', icon: '↗', className: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  satispay: { label: 'Satispay', icon: '🟠', className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300' },
  in_store: { label: 'En magasin', icon: '🏪', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  cash: { label: 'Espèces', icon: '💶', className: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' },
};

function FlagBadge({ country }: { country: string }) {
  const svg = FLAGS[country.toUpperCase()];
  if (!svg) return <span className="text-xs text-gray-500 dark:text-gray-400">{country}</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      <span className="inline-block h-3 w-4 overflow-hidden rounded-sm" dangerouslySetInnerHTML={{ __html: svg }} style={{ lineHeight: 0 }} />
      {country.toUpperCase()}
    </span>
  );
}

function DestinationCell({ fulfillmentType, shippingAddress }: { fulfillmentType: string; shippingAddress: ShippingAddress | null }) {
  if (fulfillmentType === 'pickup') {
    return <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">🏪 C&amp;C</span>;
  }
  if (!shippingAddress) return <span className="text-xs text-gray-400 dark:text-gray-500">—</span>;
  const country = shippingAddress.country ?? '';
  if (country.toUpperCase() === 'IT' || country === '') {
    return <span className="text-xs text-gray-500 dark:text-gray-400">{shippingAddress.postal_code && <span className="font-mono">{shippingAddress.postal_code}</span>}{shippingAddress.city && <span className="ml-1">{shippingAddress.city}</span>}</span>;
  }
  return <FlagBadge country={country} />;
}

function PaymentBadge({ method, status }: { method: string | null; status: string }) {
  if (!method) return <span className="text-xs text-gray-400">—</span>;
  const cfg = PAYMENT_CONFIG[method] ?? { label: method, icon: '💶', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200' };
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${status === 'paid' ? cfg.className : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}`}>
      <span>{cfg.icon}</span>{status === 'paid' ? cfg.label : `${cfg.label} · en attente`}
    </span>
  );
}

function elapsed(createdAt: string) {
  const diff = Math.max(0, Date.now() - new Date(createdAt).getTime());
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

function isAged(order: ListOrder) {
  return !['delivered', 'cancelled'].includes(order.status) && Date.now() - new Date(order.created_at).getTime() >= 24 * 60 * 60 * 1000;
}

function coldSummary(order: ListOrder) {
  return (order.order_items ?? []).reduce((acc, item) => {
    if (item.storage_type === 'frozen') acc.frozen += item.quantity;
    if (item.storage_type === 'fresh') acc.fresh += item.quantity;
    return acc;
  }, { fresh: 0, frozen: 0 });
}

function nextActionLabel(order: ListOrder) {
  if (order.status === 'new') return 'Préparer';
  if (order.status === 'preparing') return order.fulfillment_type === 'pickup' ? 'Prête au retrait' : 'Expédier';
  if (order.status === 'ready_for_pickup' && order.fulfillment_type === 'pickup') return 'Marquer retirée';
  if (order.status === 'shipped' && order.fulfillment_type === 'delivery') return 'Marquer livrée';
  return 'Voir';
}

function priority(order: ListOrder) {
  if (order.payment_status !== 'paid') return 0;
  if (isAged(order)) return 1;
  if (order.status === 'new') return 2;
  if (order.status === 'preparing') return 3;
  if (order.status === 'ready_for_pickup') return 4;
  if (order.status === 'shipped') return 5;
  if (order.status === 'delivered') return 8;
  return 9;
}

interface OrdersTableProps {
  orders: ListOrder[];
  tenantCurrency: string;
  carriers: string[];
}

export default function OrdersTable({ orders, tenantCurrency, carriers }: OrdersTableProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<'date' | 'total' | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);

  useEffect(() => { setSelectedIds(new Set()); }, [searchQuery]);
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
    if (sortBy === col) setSortDir(value => value === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  }

  function ariaSort(col: 'date' | 'total'): 'ascending' | 'descending' | 'none' {
    if (sortBy !== col) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  const filteredOrders = searchQuery.trim()
    ? orders.filter(order => {
        const q = searchQuery.toLowerCase();
        return (order.full_name ?? '').toLowerCase().includes(q) || order.email.toLowerCase().includes(q) || order.id.toLowerCase().includes(q) || order.id.slice(0, 8).toLowerCase().includes(q);
      })
    : orders;

  const sortedOrders = useMemo(() => {
    const result = [...filteredOrders];
    if (sortBy === 'date') {
      const mult = sortDir === 'asc' ? 1 : -1;
      return result.sort((a, b) => mult * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
    }
    if (sortBy === 'total') {
      const mult = sortDir === 'asc' ? 1 : -1;
      return result.sort((a, b) => mult * (a.total - b.total));
    }
    return result.sort((a, b) => priority(a) - priority(b) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [filteredOrders, sortBy, sortDir]);

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === sortedOrders.length ? new Set() : new Set(sortedOrders.map(order => order.id)));
  }

  function handleExportCsv() {
    const rows = sortedOrders.filter(order => selectedIds.has(order.id));
    const header = ['Commande', 'Date', 'Client', 'Email', 'Total', 'Statut', 'Paiement', 'Transporteur'];
    const csvEscape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const lines = rows.map(order => [
      order.id.slice(0, 8).toUpperCase(),
      new Date(order.created_at).toLocaleDateString('fr-FR'),
      order.full_name ?? '',
      order.email,
      formatPrice(order.total, tenantCurrency),
      order.status,
      order.payment_method ?? '',
      order.shipping_details?.carrierName ?? '',
    ].map(value => csvEscape(String(value))).join(','));
    const blob = new Blob(['\uFEFF' + [header.map(csvEscape).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commandes_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrintPickingLists() {
    window.open(`/admin/orders/picking-list?ids=${Array.from(selectedIds).join(',')}`, '_blank', 'noopener,noreferrer');
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
    const missingTracking = skipped.filter((item: { reason: string }) => item.reason === 'missing_tracking');
    const wrongStatus = skipped.filter((item: { reason: string }) => item.reason === 'wrong_status');
    if (missingTracking.length > 0 && !tracking) {
      setPendingTracking(missingTracking.map((item: { id: string }) => {
        const order = orders.find(candidate => candidate.id === item.id);
        return { id: item.id, label: `#${item.id.slice(0, 8).toUpperCase()} — ${order?.full_name ?? order?.email ?? ''}` };
      }));
    } else setPendingTracking(null);
    setSelectedIds(new Set([...wrongStatus.map((item: { id: string }) => item.id), ...missingTracking.map((item: { id: string }) => item.id)]));
    const parts: string[] = [];
    if (shipped.length) parts.push(`${shipped.length} expédiée${shipped.length > 1 ? 's' : ''}`);
    if (readyForPickup.length) parts.push(`${readyForPickup.length} prête${readyForPickup.length > 1 ? 's' : ''} (retrait)`);
    if (missingTracking.length && tracking) parts.push(`${missingTracking.length} ignorée${missingTracking.length > 1 ? 's' : ''} (tracking manquant)`);
    if (wrongStatus.length) parts.push(`${wrongStatus.length} ignorée${wrongStatus.length > 1 ? 's' : ''} (statut incompatible)`);
    if (parts.length) setToast({ msg: parts.join(' · '), type: shipped.length === 0 && readyForPickup.length === 0 ? 'error' : 'success' });
    router.refresh();
  }

  const handleNewOrders = useCallback((newOrders: { id: string }[]) => {
    const first = newOrders[0];
    if (!first) return;
    setToast({ msg: newOrders.length === 1 ? `Nouvelle commande #${first.id.slice(0, 8).toUpperCase()}` : `${newOrders.length} nouvelles commandes`, type: 'success' });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Nouvelle commande', { body: `Commande #${first.id.slice(0, 8).toUpperCase()}`, tag: 'lepefy-new-order' });
    }
  }, []);

  return (
    <div>
      <AdminOrdersPoller onNewOrders={handleNewOrders} isEditing={pendingTracking !== null} />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <IconSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Client, email ou n° commande..." className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-8 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100" />
          {searchQuery && <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2" aria-label="Effacer"><IconX size={13} /></Button>}
        </div>
        {searchQuery && <span className="shrink-0 text-xs text-gray-500">{filteredOrders.length} résultat{filteredOrders.length !== 1 ? 's' : ''}</span>}
      </div>

      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        {sortedOrders.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">{searchQuery ? `Aucune commande pour « ${searchQuery} »` : 'Aucune commande.'}</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400">
                    <th className="w-8 px-3 py-3"><input type="checkbox" checked={selectedIds.size > 0 && selectedIds.size === sortedOrders.length} ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedOrders.length; }} onChange={toggleSelectAll} aria-label="Sélectionner toutes les commandes" /></th>
                    <th className="w-8 px-2 py-3"><span className="sr-only">Développer</span></th>
                    <th className="px-3 py-3 text-left" aria-sort={ariaSort('date')}><button onClick={() => toggleSort('date')} className="flex items-center gap-1 uppercase">Commande {sortBy === 'date' && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}</button></th>
                    <th className="px-3 py-3 text-left">Préparation</th>
                    <th className="px-3 py-3 text-left">Remise</th>
                    <th className="px-3 py-3 text-left" aria-sort={ariaSort('total')}><button onClick={() => toggleSort('total')} className="flex items-center gap-1 uppercase">Montant {sortBy === 'total' && (sortDir === 'asc' ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />)}</button></th>
                    <th className="px-3 py-3 text-left">Workflow</th>
                    <th className="px-3 py-3 text-right">Prochaine action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedOrders.map(order => {
                    const items = order.order_items ?? [];
                    const isExpanded = expandedRows.has(order.id);
                    const cold = coldSummary(order);
                    const hasCold = cold.fresh > 0 || cold.frozen > 0;
                    const aged = isAged(order);
                    const visibleItems = items.slice(0, 2);
                    const itemQty = items.reduce((sum, item) => sum + item.quantity, 0);
                    return (
                      <Fragment key={order.id}>
                        <tr className={`border-b border-gray-100 align-top transition-colors dark:border-gray-800 ${aged ? 'bg-red-50/40 dark:bg-red-950/10' : hasCold ? 'bg-sky-50/30 dark:bg-sky-950/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}>
                          <td className="px-3 py-3"><input type="checkbox" checked={selectedIds.has(order.id)} onChange={() => toggleSelect(order.id)} aria-label={`Sélectionner #${order.id.slice(0, 8).toUpperCase()}`} /></td>
                          <td className="px-2 py-3">{items.length > 0 && <Button variant="ghost" size="sm" onClick={() => toggleRow(order.id)} aria-label={isExpanded ? 'Réduire' : 'Développer'}>{isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}</Button>}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-xs font-bold text-gray-800 dark:text-gray-200">#{order.id.slice(0, 8).toUpperCase()}</span>
                              {aged && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300"><IconAlertTriangle size={10} /> +24 h</span>}
                            </div>
                            <p className="mt-1 max-w-[180px] truncate text-sm font-semibold text-gray-950 dark:text-gray-100">{order.full_name ?? order.email}</p>
                            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-gray-400"><IconClock size={11} /> {elapsed(order.created_at)}</p>
                          </td>
                          <td className="max-w-[260px] px-3 py-3">
                            <div className="mb-1.5 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-700 dark:bg-gray-800 dark:text-gray-200">{itemQty} unité{itemQty > 1 ? 's' : ''}</span>
                              {cold.frozen > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-200"><IconSnowflake size={11} /> {cold.frozen} surgelé{cold.frozen > 1 ? 's' : ''}</span>}
                              {cold.fresh > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><IconTemperature size={11} /> {cold.fresh} frais</span>}
                            </div>
                            {visibleItems.map(item => <p key={item.id} className="truncate text-xs text-gray-600 dark:text-gray-300"><strong>×{item.quantity}</strong> {item.name}{item.warehouse_location ? ` · ${item.warehouse_location}` : ''}</p>)}
                            {items.length > 2 && <p className="mt-0.5 text-[11px] text-gray-400">+{items.length - 2} autre{items.length - 2 > 1 ? 's' : ''}</p>}
                          </td>
                          <td className="px-3 py-3"><DestinationCell fulfillmentType={order.fulfillment_type} shippingAddress={order.shipping_address} />{order.shipping_details?.carrierName && <p className="mt-1 text-[11px] text-gray-400">{order.shipping_details.carrierName}</p>}</td>
                          <td className="px-3 py-3 whitespace-nowrap"><p className="font-bold text-gray-950 dark:text-gray-100">{formatPrice(order.total, tenantCurrency)}</p><div className="mt-1"><PaymentBadge method={order.payment_method} status={order.payment_status} /></div></td>
                          <td className="px-3 py-3"><StatusBadge status={order.status} />{order.payment_status !== 'paid' && <p className="mt-1 text-[10px] font-semibold text-amber-600">Paiement à vérifier</p>}</td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <Link href={`/admin/orders/${order.id}/picking-list`} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700" aria-label="Imprimer la liste de préparation"><IconPrinter size={15} /></Link>
                              <Link href={`/admin/orders/${order.id}`} className="inline-flex min-h-9 items-center rounded-lg bg-[var(--admin-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90">{nextActionLabel(order)}</Link>
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td />
                            <td colSpan={7} className="px-4 pb-4 pt-1">
                              <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-gray-800"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Détail préparation</span><span className="text-xs text-gray-400">{order.email}</span></div>
                                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                  {items.map(item => (
                                    <div key={item.id} className={`flex items-center gap-3 px-4 py-2.5 ${item.storage_type === 'frozen' ? 'bg-blue-50/50 dark:bg-blue-950/10' : item.storage_type === 'fresh' ? 'bg-emerald-50/40 dark:bg-emerald-950/10' : ''}`}>
                                      <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-gray-950 px-1.5 text-xs font-bold text-white dark:bg-white dark:text-gray-950">×{item.quantity}</span>
                                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{item.name}</p><div className="mt-1 flex flex-wrap gap-1.5">{item.warehouse_location && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{item.warehouse_location}</span>}{item.storage_type === 'frozen' && <span className="text-[10px] font-bold text-blue-700">❄ Surgelé</span>}{item.storage_type === 'fresh' && <span className="text-[10px] font-bold text-emerald-700">🌡 Frais</span>}</div></div>
                                      <span className="shrink-0 text-sm font-semibold">{formatPrice(item.subtotal, tenantCurrency)}</span>
                                    </div>
                                  ))}
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

            <ul className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden" role="list" aria-label="Commandes">
              {sortedOrders.map(order => {
                const cold = coldSummary(order);
                const aged = isAged(order);
                const itemQty = (order.order_items ?? []).reduce((sum, item) => sum + item.quantity, 0);
                return (
                  <li key={order.id} className={aged ? 'bg-red-50/40 dark:bg-red-950/10' : cold.fresh || cold.frozen ? 'bg-sky-50/30 dark:bg-sky-950/10' : ''}>
                    <Link href={`/admin/orders/${order.id}`} className="block p-4 active:bg-gray-50 dark:active:bg-gray-800">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono text-xs font-bold text-gray-700 dark:text-gray-200">#{order.id.slice(0, 8).toUpperCase()}</span>{aged && <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">+24 h</span>}</div>
                          <p className="mt-1 truncate text-sm font-semibold text-gray-950 dark:text-gray-100">{order.full_name ?? order.email}</p>
                          <p className="mt-0.5 text-xs text-gray-400">{itemQty} unité{itemQty > 1 ? 's' : ''} · ouverte depuis {elapsed(order.created_at)}</p>
                        </div>
                        <StatusBadge status={order.status} />
                      </div>
                      {(cold.frozen > 0 || cold.fresh > 0) && <div className="mt-2 flex flex-wrap gap-1.5">{cold.frozen > 0 && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-bold text-blue-800">❄ {cold.frozen} surgelé{cold.frozen > 1 ? 's' : ''}</span>}{cold.fresh > 0 && <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800">🌡 {cold.fresh} frais</span>}</div>}
                      <div className="mt-3 flex items-end justify-between gap-3"><div><DestinationCell fulfillmentType={order.fulfillment_type} shippingAddress={order.shipping_address} /><div className="mt-1"><PaymentBadge method={order.payment_method} status={order.payment_status} /></div></div><div className="text-right"><p className="font-bold text-gray-950 dark:text-gray-100">{formatPrice(order.total, tenantCurrency)}</p><p className="mt-1 text-xs font-semibold text-[var(--admin-primary-fg)]">{nextActionLabel(order)} →</p></div></div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {selectedIds.size > 0 && (
        <div role="toolbar" aria-label="Actions groupées" className="sticky bottom-4 z-20 mx-auto mt-4 flex max-w-fit items-center gap-3 rounded-full bg-gray-900 px-4 py-2.5 text-white shadow-lg dark:bg-gray-800">
          <span className="text-sm font-medium">{selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}</span>
          <div className="h-4 w-px bg-white/20" />
          <button onClick={handleExportCsv} className="text-sm hover:opacity-80">Exporter CSV</button>
          <button onClick={handlePrintPickingLists} className="text-sm hover:opacity-80">Imprimer les listes</button>
          <button onClick={() => handleMarkShipped()} className="text-sm hover:opacity-80">Traiter la sélection</button>
          <button onClick={() => setSelectedIds(new Set())} aria-label="Annuler la sélection" className="ml-1 rounded-full p-1 hover:bg-white/10"><IconX size={14} /></button>
        </div>
      )}

      {pendingTracking && <BulkTrackingModal orders={pendingTracking} carrierOptions={carriers} onCancel={() => setPendingTracking(null)} onConfirm={tracking => { handleMarkShipped(tracking); }} />}

      {toast && <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-[var(--color-primary)]' : 'bg-red-500'}`}>{toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}{toast.msg}</div>}
    </div>
  );
}
