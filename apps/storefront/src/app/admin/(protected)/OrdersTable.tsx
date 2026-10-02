'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { IconCheck, IconChevronDown, IconChevronRight, IconPrinter, IconX } from '@tabler/icons-react';
import { nextOrderAction, orderQueueFlags, urgencyLabel, lastTrackingEventAt, type OperationalThresholds } from '@/lib/orders/adminOrderOperations';
import { safeShipmentTrackingUrl, shipmentStatusLabel } from '@/lib/shipping/shipmentPresentation';
import type { CartonSuggestion } from '@/lib/shipping/cartonSuggestion';
import type { NormalizedShipmentStatus, OrderStatus, ShipmentTrackingEvent } from '@lepefy/types';
import StatusBadge from '../_components/ui/StatusBadge';
import BulkTrackingModal, { type PendingTrackingOrder } from '../_components/ui/BulkTrackingModal';
import AdminOrdersPoller from './AdminOrdersPoller';

interface ShippingAddress { city?: string; postal_code?: string; country?: string; line1?: string }
interface ShippingDetails { carrierName?: string; serviceName?: string; numParcels?: number; totalWeightG?: number }
export interface OrderItemRow { id: string; name: string; quantity: number; subtotal: number; storage_type: string | null; warehouse_location?: string | null }
export interface ListOrder {
  id: string; created_at: string; updated_at: string; full_name: string | null; email: string | null;
  fulfillment_type: 'delivery' | 'pickup'; shipping_address: ShippingAddress | null; shipping_details: ShippingDetails | null;
  subtotal: number; shipping_cost: number; total: number; payment_method: string | null; payment_status: string; status: OrderStatus;
  tracking_code: string | null; tracking_carrier: string | null; shipping_tracking_url: string | null;
  shipping_tracking_mode: 'managed' | 'manual' | null; shipping_provider_key: string | null; shipping_provider_reference: string | null;
  shipping_normalized_status: NormalizedShipmentStatus | null; shipping_provider_synced_at: string | null; shipping_sync_error: string | null;
  shipping_tracking_events: ShipmentTrackingEvent[] | null; shipping_estimated_delivery_at: string | null;
  picking_started_at: string | null; picking_completed_at: string | null; packing_completed_at: string | null; packing_parcel_count: number | null;
  order_items: OrderItemRow[];
}
interface DetailData { suggestion: CartonSuggestion | null; missingWeightLines: number }
interface Props { orders: ListOrder[]; tenantCurrency: string; carriers: string[]; thresholds: OperationalThresholds; canManage: boolean; managedProviderAvailable: boolean; nowIso: string }

function ageLabel(date: string | null | undefined, now: Date) {
  if (!date || !Number.isFinite(Date.parse(date))) return null;
  const hours = Math.max(0, Math.floor((now.getTime() - Date.parse(date)) / 3_600_000));
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} j`;
}
function compactAddress(order: ListOrder) {
  const address = order.shipping_address;
  return [address?.postal_code, address?.city, address?.country].filter(Boolean).join(' ');
}
function parcelCount(order: ListOrder) { return order.packing_parcel_count ?? order.shipping_details?.numParcels ?? null; }
function weightLabel(order: ListOrder) {
  const weight = order.shipping_details?.totalWeightG;
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? `${(weight / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg` : null;
}
function coldSummary(order: ListOrder) {
  return order.order_items.reduce((total, item) => {
    if (item.storage_type === 'fresh') total.fresh += item.quantity;
    if (item.storage_type === 'frozen') total.frozen += item.quantity;
    return total;
  }, { fresh: 0, frozen: 0 });
}
function logisticsLabel(order: ListOrder) {
  if (order.fulfillment_type === 'pickup') return null;
  if (order.shipping_sync_error) return 'Synchronisation en erreur';
  if (order.shipping_provider_reference) return shipmentStatusLabel(order.shipping_normalized_status);
  return order.shipping_tracking_mode === 'manual' ? 'Suivi manuel' : 'Expédition non associée';
}
function formatEta(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeZone: 'Europe/Rome' }).format(new Date(value)) : null;
}

export default function OrdersTable({ orders, tenantCurrency, carriers, thresholds, canManage, managedProviderAvailable, nowIso }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Record<string, DetailData>>({});
  const [detailError, setDetailError] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const now = new Date(nowIso);
  useEffect(() => { setSelected(new Set()); setExpanded(new Set()); setDetail({}); setDetailError(new Set()); }, [orders]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); }, [toast]);

  async function loadDetail(id: string) {
    setLoading(previous => new Set(previous).add(id));
    try {
      const response = await fetch(`/api/admin/orders/${id}/operation-detail`);
      if (!response.ok) throw new Error('detail_unavailable');
      const data = await response.json() as DetailData;
      setDetail(previous => ({ ...previous, [id]: data }));
      setDetailError(previous => { const next = new Set(previous); next.delete(id); return next; });
    } catch {
      setDetailError(previous => new Set(previous).add(id));
    } finally {
      setLoading(previous => { const next = new Set(previous); next.delete(id); return next; });
    }
  }
  function toggleDetail(id: string) {
    const opening = !expanded.has(id);
    setExpanded(previous => { const next = new Set(previous); opening ? next.add(id) : next.delete(id); return next; });
    if (opening && !detail[id] && !loading.has(id)) void loadDetail(id);
  }
  function toggleSelect(id: string) { setSelected(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; }); }
  function exportCsv() {
    const rows = orders.filter(order => selected.has(order.id));
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [['Commande', 'Date', 'Client', 'Email', 'Total', 'Statut', 'Paiement', 'Transporteur'].map(cell).join(','),
      ...rows.map(order => [order.id.slice(0, 8).toUpperCase(), order.created_at, order.full_name, order.email, order.total, order.status, order.payment_method, order.tracking_carrier ?? order.shipping_details?.carrierName].map(cell).join(','))];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `commandes_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  async function handleBulk(tracking?: Record<string, { carrier: string; code: string }>) {
    const ids = tracking ? Object.keys(tracking) : Array.from(selected);
    try {
      const response = await fetch('/api/admin/orders/bulk-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: ids, tracking }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Erreur de mise à jour.');
      const missing = (body.skipped ?? []).filter((entry: { reason: string }) => entry.reason === 'missing_tracking');
      if (missing.length && !tracking) setPendingTracking(missing.map((entry: { id: string }) => ({ id: entry.id, label: `#${entry.id.slice(0, 8).toUpperCase()}` })));
      else setPendingTracking(null);
      setToast({ msg: `${body.shipped.length} expédiée(s) · ${body.readyForPickup.length} prête(s) au retrait`, type: 'success' });
      setSelected(new Set()); router.refresh();
    } catch (error) { setToast({ msg: error instanceof Error ? error.message : 'Erreur de mise à jour.', type: 'error' }); }
  }
  const onNewOrders = useCallback((newOrders: { id: string }[]) => {
    if (!newOrders.length) return;
    setToast({ msg: `${newOrders.length} nouvelle(s) commande(s)`, type: 'success' });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Nouvelle commande', { body: `Commande #${newOrders[0]!.id.slice(0, 8).toUpperCase()}` });
  }, []);

  function detailPanel(order: ListOrder) {
    const loaded = detail[order.id];
    const items = order.order_items ?? [];
    const trackingUrl = safeShipmentTrackingUrl(order.shipping_tracking_url);
    return <div id={`order-detail-${order.id}`} className="grid gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs dark:border-gray-700 dark:bg-gray-950 md:grid-cols-3">
      <section><h3 className="mb-2 font-bold uppercase tracking-wide text-gray-500">Préparation</h3>
        <ul className="space-y-1">{items.map(item => <li key={item.id}><b>×{item.quantity}</b> {item.name}{item.warehouse_location ? ` · ${item.warehouse_location}` : ''}</li>)}</ul>
        {weightLabel(order) && <p className="mt-2">Poids total : {weightLabel(order)}</p>}{parcelCount(order) != null && <p>Colis : {parcelCount(order)}</p>}
        {loading.has(order.id) && <p role="status" className="mt-2">Suggestion carton en cours…</p>}
        {detailError.has(order.id) && <p role="alert" className="mt-2 text-red-700">Suggestion indisponible. <button type="button" onClick={() => void loadDetail(order.id)} className="underline">Réessayer</button></p>}
        {loaded?.suggestion && <div className="mt-2"><b>Cartons suggérés</b>{loaded.suggestion.parcels.map((parcel, index) => <p key={index}>Colis {index + 1} : {parcel.carton?.name ?? 'Aucun profil adapté'} · {(parcel.weightG / 1000).toFixed(2)} kg</p>)}</div>}
        {loaded && loaded.missingWeightLines > 0 && <p className="mt-2 font-semibold text-amber-700">{loaded.missingWeightLines} ligne(s) sans poids produit.</p>}
      </section>
      <section><h3 className="mb-2 font-bold uppercase tracking-wide text-gray-500">{order.fulfillment_type === 'pickup' ? 'Retrait' : 'Expédition'}</h3>
        {order.fulfillment_type === 'pickup' ? <><p>Retrait magasin</p><p>État : {order.status === 'ready_for_pickup' ? 'Prêt à retirer' : order.status}</p>{order.email && <p>Contact : {order.email}</p>}</>
          : <><p>{compactAddress(order) || 'Destination indisponible'}</p>{order.shipping_details?.serviceName && <p>Service : {order.shipping_details.serviceName}</p>}
            {(order.tracking_carrier ?? order.shipping_details?.carrierName) && <p>Transporteur : {order.tracking_carrier ?? order.shipping_details?.carrierName}</p>}
            {order.shipping_provider_key && <p>Provider : {order.shipping_provider_key}</p>}
            {order.shipping_provider_reference && <p>Référence : <span className="break-all font-mono">{order.shipping_provider_reference}</span></p>}
            {order.tracking_code && <p>Tracking : <span className="break-all font-mono">{order.tracking_code}</span></p>}
            <p>Logistique : {logisticsLabel(order)}</p>{lastTrackingEventAt(order) && <p>Dernier mouvement : {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(lastTrackingEventAt(order)!))}</p>}
            {formatEta(order.shipping_estimated_delivery_at) && <p>Livraison estimée : {formatEta(order.shipping_estimated_delivery_at)}</p>}</>}
      </section>
      <section><h3 className="mb-2 font-bold uppercase tracking-wide text-gray-500">Actions</h3><div className="flex flex-col items-start gap-2">
        <Link href={`/admin/orders/${order.id}/picking-list`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 font-semibold dark:bg-gray-900"><IconPrinter size={15} /> Imprimer la liste de préparation</Link>
        <Link href={`/admin/orders/${order.id}`} className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 font-semibold dark:bg-gray-900">Voir la commande</Link>
        {trackingUrl && <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-lg border border-gray-300 bg-white px-3 py-2 font-semibold dark:bg-gray-900">Voir le suivi transporteur</a>}
      </div></section>
    </div>;
  }

  function actionLink(order: ListOrder, full = false) {
    const action = nextOrderAction({ ...order, managedProviderAvailable });
    const label = canManage ? action.label : 'Voir la commande';
    return <Link href={`/admin/orders/${order.id}`} aria-label={`${label} pour la commande ${order.id.slice(0, 8).toUpperCase()}`}
      className={`${full ? 'w-full ' : ''}inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] ${action.primary && canManage ? 'bg-[var(--admin-primary)] text-white' : 'border border-[var(--admin-border)] bg-white text-gray-700 dark:bg-gray-900 dark:text-gray-200'}`}>{label}</Link>;
  }
  function logisticsCell(order: ListOrder) {
    if (order.fulfillment_type === 'pickup') return <strong className="text-xs">🏬 Retrait magasin</strong>;
    const carrier = order.tracking_carrier ?? order.shipping_details?.carrierName;
    return <div className="max-w-[235px] text-xs"><strong>🚚 Livraison</strong><p className="truncate">{compactAddress(order) || 'Destination indisponible'}</p>
      {carrier && <p className="truncate text-gray-500">{carrier}</p>}
      <p className="truncate text-gray-500">{[order.shipping_provider_reference, order.tracking_code && `suivi ${order.tracking_code}`].filter(Boolean).join(' · ') || [parcelCount(order) != null && `${parcelCount(order)} colis`, weightLabel(order)].filter(Boolean).join(' · ')}</p>
    </div>;
  }
  function stateCell(order: ListOrder) {
    const logistics = logisticsLabel(order);
    const lastMove = lastTrackingEventAt(order);
    const flags = orderQueueFlags(order, thresholds, now);
    return <div className="space-y-1"><StatusBadge status={order.status} fulfillmentType={order.fulfillment_type} />{logistics && <p className={`text-[11px] ${flags.has('incidents') ? 'font-bold text-red-700' : 'text-gray-500'}`}>Logistique : {logistics}</p>}
      {lastMove && <p className="text-[10px] text-gray-400">Mouvement il y a {ageLabel(lastMove, now)}</p>}
      {formatEta(order.shipping_estimated_delivery_at) && order.status === 'shipped' && <p className="text-[10px] text-gray-500">Livraison estimée : {formatEta(order.shipping_estimated_delivery_at)}</p>}
      {order.payment_status !== 'paid' && <p className="text-[10px] font-bold text-amber-700">Paiement à vérifier</p>}</div>;
  }
  if (!orders.length) return <div className="rounded-2xl border border-[var(--admin-border)] bg-white px-4 py-12 text-center text-sm text-gray-500 dark:bg-gray-900">Aucune commande pour ces filtres. <Link href="/admin" className="font-semibold text-[var(--admin-primary-fg)] underline">Voir toutes les commandes</Link></div>;
  return <div>
    <AdminOrdersPoller onNewOrders={onNewOrders} isEditing={pendingTracking !== null || expanded.size > 0} />
    <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:bg-gray-900">
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead><tr className="border-b border-gray-100 bg-gray-50 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800">
        <th className="w-8 p-3"><input type="checkbox" checked={selected.size === orders.length} onChange={() => setSelected(selected.size === orders.length ? new Set() : new Set(orders.map(order => order.id)))} aria-label="Sélectionner les commandes de cette page" /></th>
        <th className="w-8 p-2"><span className="sr-only">Détail</span></th><th className="p-3">Commande</th><th className="p-3">À préparer</th><th className="p-3">Livraison / Retrait</th><th className="p-3">État</th><th className="p-3 text-right">Action</th>
      </tr></thead><tbody>{orders.map(order => { const open = expanded.has(order.id); const count = order.order_items.reduce((sum, item) => sum + item.quantity, 0); const cold = coldSummary(order); const urgency = urgencyLabel(order, thresholds, now); const done = ['delivered', 'cancelled'].includes(order.status);
        return <Fragment key={order.id}><tr className={`border-b border-gray-100 align-top dark:border-gray-800 ${done ? 'opacity-65' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'}`}>
          <td className="p-3"><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} aria-label={`Sélectionner ${order.id.slice(0, 8)}`} /></td>
          <td className="p-2"><button type="button" onClick={() => toggleDetail(order.id)} aria-expanded={open} aria-controls={`order-detail-${order.id}`} aria-label={`${open ? 'Réduire' : 'Développer'} la commande ${order.id.slice(0, 8)}`} className="min-h-11 min-w-11 rounded-lg hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)]">{open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}</button></td>
          <td className="p-3"><span className="font-mono text-xs font-bold">#{order.id.slice(0, 8).toUpperCase()}</span>{urgency && <p className="mt-1 text-[10px] font-bold text-amber-700">{urgency}</p>}<p className="mt-1 max-w-[180px] truncate font-semibold">{order.full_name ?? order.email ?? 'Client'}</p><p className="text-[11px] text-gray-400">il y a {ageLabel(order.created_at, now) ?? '—'}</p></td>
          <td className="max-w-[220px] p-3"><b className="text-xs">{count} unité{count !== 1 ? 's' : ''}</b>{cold.fresh > 0 && <span className="ml-1 text-[10px] font-semibold text-emerald-700">🌡 {cold.fresh} frais</span>}{cold.frozen > 0 && <span className="ml-1 text-[10px] font-semibold text-blue-700">❄ {cold.frozen} surgelé(s)</span>}{order.order_items.slice(0, 2).map(item => <p key={item.id} className="truncate text-xs text-gray-600 dark:text-gray-300">×{item.quantity} {item.name}</p>)}{order.order_items.length > 2 && <p className="text-[11px] text-gray-400">+{order.order_items.length - 2} autre(s)</p>}</td>
          <td className="p-3">{logisticsCell(order)}</td><td className="p-3">{stateCell(order)}</td><td className="p-3 text-right">{actionLink(order)}</td>
        </tr>{open && <tr><td colSpan={7} className="p-3">{detailPanel(order)}</td></tr>}</Fragment>; })}</tbody></table></div>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden" aria-label="Commandes">{orders.map(order => { const open = expanded.has(order.id); const count = order.order_items.reduce((sum, item) => sum + item.quantity, 0); const cold = coldSummary(order); const urgency = urgencyLabel(order, thresholds, now); const done = ['delivered', 'cancelled'].includes(order.status);
        return <li key={order.id} className={`p-4 ${done ? 'opacity-65' : ''}`}><div className="flex items-start justify-between gap-2"><div><b className="font-mono text-xs">#{order.id.slice(0, 8).toUpperCase()}</b><p className="font-semibold">{order.full_name ?? order.email ?? 'Client'}</p></div>{urgency && <span className="text-right text-[10px] font-bold text-amber-700">{urgency}</span>}</div>
          <p className="mt-2 text-xs font-semibold">{count} unité{count !== 1 ? 's' : ''}{weightLabel(order) && ` · ${weightLabel(order)}`}</p><p className="truncate text-xs text-gray-500">{order.order_items.slice(0, 2).map(item => `×${item.quantity} ${item.name}`).join(' · ')}</p>
          {(cold.fresh > 0 || cold.frozen > 0) && <p className="mt-1 text-[10px] font-semibold text-sky-700">{cold.fresh > 0 && `🌡 ${cold.fresh} frais`}{cold.fresh > 0 && cold.frozen > 0 && ' · '}{cold.frozen > 0 && `❄ ${cold.frozen} surgelé(s)`}</p>}
          <div className="mt-2">{logisticsCell(order)}</div><div className="mt-2">{stateCell(order)}</div><div className="mt-3">{actionLink(order, true)}</div>
          <button type="button" onClick={() => toggleDetail(order.id)} aria-expanded={open} aria-controls={`order-detail-${order.id}`} className="mt-2 min-h-11 w-full rounded-lg text-xs font-semibold text-[var(--admin-primary-fg)] focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)]">{open ? 'Masquer les détails ⌃' : 'Détails et actions ⌄'}</button>{open && detailPanel(order)}</li>; })}</ul>
    </div>
    {selected.size > 0 && <div role="toolbar" aria-label="Actions groupées" className="sticky bottom-4 z-20 mx-auto mt-4 flex max-w-fit flex-wrap items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-white shadow-lg"><span className="text-xs font-bold">{selected.size} sélectionnée(s)</span><button type="button" onClick={exportCsv} className="text-xs underline">Exporter CSV</button><button type="button" onClick={() => window.open(`/admin/orders/picking-list?ids=${Array.from(selected).join(',')}`, '_blank', 'noopener,noreferrer')} className="text-xs underline">Imprimer les listes de préparation</button>{canManage && <button type="button" onClick={() => void handleBulk()} className="text-xs underline">Traiter la sélection</button>}<button type="button" onClick={() => setSelected(new Set())} aria-label="Annuler la sélection"><IconX size={16} /></button></div>}
    {pendingTracking && <BulkTrackingModal orders={pendingTracking} carrierOptions={carriers} onCancel={() => setPendingTracking(null)} onConfirm={tracking => { void handleBulk(tracking); }} />}
    {toast && <div role="status" className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-lg ${toast.type === 'success' ? 'bg-emerald-700' : 'bg-red-700'}`}>{toast.type === 'success' ? <IconCheck size={16} /> : <IconX size={16} />}{toast.msg}</div>}
  </div>;
}
