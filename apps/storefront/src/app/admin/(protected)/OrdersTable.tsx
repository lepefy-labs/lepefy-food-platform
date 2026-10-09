'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertTriangle, IconBuildingStore, IconCheck, IconChevronDown, IconChevronRight, IconExternalLink,
  IconFileTypePdf, IconPrinter, IconSnowflake, IconTemperature, IconTruck, IconX,
} from '@tabler/icons-react';
import { ORDER_DOCUMENT_FORMATS } from '@/lib/orders/documents/formats';
import {
  classifyOrderOperation, formatSince, lastTrackingEventAt, PRIORITY_GROUP_LABELS, transportState,
  type OperationalThresholds, type OrderOperation, type OrderSortKey,
} from '@/lib/orders/adminOrderOperations';
import { carrierDisplayName, safeShipmentTrackingUrl, shipmentDate } from '@/lib/shipping/shipmentPresentation';
import type { CartonSuggestion } from '@/lib/shipping/cartonSuggestion';
import type { NormalizedShipmentStatus, OrderStatus, ShipmentTrackingEvent } from '@lepefy/types';
import StatusBadge from '../_components/ui/StatusBadge';
import CopyableValue from '../_components/ui/CopyableValue';
import BulkTrackingModal, { type PendingTrackingOrder } from '../_components/ui/BulkTrackingModal';
import AdminOrdersPoller from './AdminOrdersPoller';
import BulkDocumentsDialog from './BulkDocumentsDialog';
import type { OrderDocumentsDefaults } from '../orders/[id]/OrderDocumentsCard';

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
  shipping_tracking_events: ShipmentTrackingEvent[] | null; shipping_estimated_delivery_at: string | null; shipped_at?: string | null;
  picking_started_at: string | null; picking_completed_at: string | null; packing_completed_at: string | null; packing_parcel_count: number | null;
  order_items: OrderItemRow[];
}
interface DetailData { suggestion: CartonSuggestion | null; missingWeightLines: number }
interface Props {
  orders: ListOrder[]; tenantCurrency: string; carriers: string[]; thresholds: OperationalThresholds;
  canManage: boolean; managedProviderAvailable: boolean; nowIso: string; originCountry: string; sort: OrderSortKey;
  documentDefaults: OrderDocumentsDefaults;
}

const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
function compactAddress(order: ListOrder) {
  const address = order.shipping_address;
  return [address?.postal_code, address?.city, address?.country].filter(Boolean).join(' ');
}
function parcelCount(order: ListOrder) { return order.packing_parcel_count ?? order.shipping_details?.numParcels ?? null; }
function weightLabel(order: ListOrder) {
  const weight = order.shipping_details?.totalWeightG;
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? `${(weight / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg` : null;
}
function carrierOf(order: ListOrder) { return carrierDisplayName(order.tracking_carrier ?? order.shipping_details?.carrierName); }
function coldSummary(order: ListOrder) {
  return order.order_items.reduce((total, item) => {
    if (item.storage_type === 'fresh') total.fresh += item.quantity;
    if (item.storage_type === 'frozen') total.frozen += item.quantity;
    return total;
  }, { fresh: 0, frozen: 0 });
}
const TRANSPORT_TONES = {
  danger: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900',
  neutral: 'bg-gray-50 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700',
};
function formatOrderDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(date)
    : 'Date indisponible';
}
function handlingBadges(operation: OrderOperation) {
  const { international, fresh, frozen, score } = operation.handling;
  if (!international && !fresh && !frozen) return null;
  return <span className="flex flex-wrap gap-1" aria-label="Attention logistique">
    {score === 3 && <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-900 dark:bg-rose-950 dark:text-rose-200">Priorité élevée</span>}
    {international && <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-900 dark:bg-blue-950 dark:text-blue-200">International</span>}
    {fresh && <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200">Produits frais</span>}
    {frozen && <span className="rounded-md bg-cyan-100 px-2 py-0.5 text-[11px] font-bold text-cyan-900 dark:bg-cyan-950 dark:text-cyan-200">Surgelés</span>}
  </span>;
}
function formatEta(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' }).format(new Date(value)) : null;
}

export default function OrdersTable({ orders, tenantCurrency, carriers, thresholds, canManage, managedProviderAvailable, nowIso, originCountry, sort, documentDefaults }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Record<string, DetailData>>({});
  const [detailError, setDetailError] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const money = useMemo(() => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: tenantCurrency || 'EUR' }), [tenantCurrency]);
  const operations = useMemo(() => new Map(orders.map(order => [order.id, classifyOrderOperation({ ...order, originCountry, managedProviderAvailable }, thresholds, now)])), [orders, managedProviderAvailable, thresholds, now]);
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
  function toggleDetail(order: ListOrder) {
    const opening = !expanded.has(order.id);
    setExpanded(previous => { const next = new Set(previous); if (opening) next.add(order.id); else next.delete(order.id); return next; });
    if (opening && order.fulfillment_type === 'delivery' && order.status !== 'cancelled' && !detail[order.id] && !loading.has(order.id)) void loadDetail(order.id);
  }
  function toggleSelect(id: string) { setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function exportCsv() {
    const rows = orders.filter(order => selected.has(order.id));
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [['Commande', 'Date', 'Client', 'Email', 'Total', 'Statut', 'Paiement', 'Transporteur'].map(cell).join(','),
      ...rows.map(order => [order.id.slice(0, 8).toUpperCase(), order.created_at, order.full_name, order.email, order.total, order.status, order.payment_method, carrierOf(order)].map(cell).join(','))];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `commandes_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  async function handleBulk(tracking?: Record<string, { carrier: string; code: string }>) {
    const ids = tracking ? Object.keys(tracking) : Array.from(selected);
    try {
      const response = await fetch('/api/admin/orders/bulk-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: ids, tracking }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Erreur de mise à jour.');
      const missing = (body.skipped ?? []).filter((entry: { reason: string }) => entry.reason === 'missing_tracking');
      if (missing.length && !tracking) setPendingTracking(missing.map((entry: { id: string }) => ({ id: entry.id, label: shortId(entry.id) })));
      else setPendingTracking(null);
      setToast({ msg: `${body.shipped.length} expédiée(s) · ${body.readyForPickup.length} prête(s) au retrait`, type: 'success' });
      setSelected(new Set()); router.refresh();
    } catch (error) { setToast({ msg: error instanceof Error ? error.message : 'Erreur de mise à jour.', type: 'error' }); }
  }
  const onNewOrders = useCallback((newOrders: { id: string }[]) => {
    if (!newOrders.length) return;
    setToast({ msg: `${newOrders.length} nouvelle(s) commande(s)`, type: 'success' });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Nouvelle commande', { body: `Commande ${shortId(newOrders[0]!.id)}` });
  }, []);

  const operationOf = (order: ListOrder) => operations.get(order.id)!;
  const done = (order: ListOrder) => operationOf(order).group === 'finished';

  const copyable = (label: string, value: string) => <CopyableValue label={label} value={value} />;

  function fulfillmentCell(order: ListOrder) {
    if (order.fulfillment_type === 'pickup') return <p className="inline-flex items-center gap-1.5 text-xs font-semibold"><IconBuildingStore size={15} aria-hidden="true" /> Retrait magasin</p>;
    const carrier = carrierOf(order);
    const meta = [carrier, parcelCount(order) != null && `${parcelCount(order)} colis`, weightLabel(order)].filter(Boolean).join(' · ');
    return <div className="max-w-[260px] space-y-0.5 text-xs">
      <p className="flex items-center gap-1.5"><IconTruck size={15} aria-hidden="true" className="shrink-0" /><b>Livraison</b><span className="truncate text-gray-600 dark:text-gray-300">· {compactAddress(order) || 'Destination indisponible'}</span></p>
      {meta && <p className="truncate text-gray-500">{meta}</p>}
      {order.shipping_provider_reference && copyable('Réf.', order.shipping_provider_reference)}
      {order.tracking_code && order.tracking_code !== order.shipping_provider_reference && copyable('Suivi', order.tracking_code)}
    </div>;
  }

  function stateCell(order: ListOrder, operation: OrderOperation) {
    const transport = transportState(order);
    const lastMove = lastTrackingEventAt(order);
    const eta = order.status === 'shipped' ? formatEta(order.shipping_estimated_delivery_at) : null;
    return <div className="space-y-1">
      <StatusBadge status={order.status} fulfillmentType={order.fulfillment_type} />
      {transport && !done(order) && <p><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TRANSPORT_TONES[transport.tone]}`}>Transport : {transport.label}</span></p>}
      {lastMove && order.status === 'shipped' && <p className="text-[11px] text-gray-500">Mouvement {formatSince(lastMove, now)}</p>}
      {eta && <p className="text-[11px] text-gray-500">Livraison estimée : {eta}</p>}
      {operation.anomaly && <p className={`flex items-start gap-1 text-[11px] font-semibold ${operation.flags.has('incidents') || operation.anomaly.code === 'stock_conflict' ? 'text-red-700 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}><IconAlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />{operation.anomaly.label}</p>}
      {operation.notice && <p className="flex items-start gap-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300"><IconAlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />{operation.notice}</p>}
    </div>;
  }

  function actionLink(order: ListOrder, operation: OrderOperation, full = false) {
    const { action } = operation;
    const label = canManage || action.intent === 'tracking' ? action.label : 'Voir la commande';
    const trackingUrl = action.intent === 'tracking' ? safeShipmentTrackingUrl(order.shipping_tracking_url) : null;
    const style = done(order)
      ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800'
      : action.primary && (canManage || action.intent === 'tracking')
        ? 'border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200'
        : 'border border-[var(--admin-border)] bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200';
    const className = `${full ? 'w-full ' : ''}inline-flex min-h-10 items-center justify-center gap-1 rounded-lg px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-primary)] ${style}`;
    if (trackingUrl) return <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className={className}>{label}<IconExternalLink size={13} aria-hidden="true" /><span className="sr-only"> (suivi transporteur, nouvel onglet) — commande {shortId(order.id)}</span></a>;
    return <Link href={`/admin/orders/${order.id}`} className={className}>{label}<span className="sr-only"> — commande {shortId(order.id)}</span></Link>;
  }

  function detailPanel(order: ListOrder, operation: OrderOperation) {
    const loaded = detail[order.id];
    const trackingUrl = safeShipmentTrackingUrl(order.shipping_tracking_url);
    const lastMove = lastTrackingEventAt(order);
    const eta = formatEta(order.shipping_estimated_delivery_at);
    const detailButton = 'inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-[var(--admin-border)] bg-white px-3 font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:bg-gray-900 dark:text-gray-200 sm:w-auto sm:justify-start';
    return <div id={`order-detail-${order.id}`} className="grid gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-300 md:grid-cols-3">
      <section aria-label="Préparation"><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Préparation</h3>
        <ul className="space-y-1">{order.order_items.map(item => <li key={item.id}><b>×{item.quantity}</b> {item.name}{item.warehouse_location ? <span className="text-gray-500"> · {item.warehouse_location}</span> : null}</li>)}</ul>
        {(weightLabel(order) || parcelCount(order) != null) && <p className="mt-2">{[weightLabel(order) && `Poids total ${weightLabel(order)}`, parcelCount(order) != null && `${parcelCount(order)} colis`].filter(Boolean).join(' · ')}</p>}
        {loading.has(order.id) && <p role="status" className="mt-2 text-gray-500">Suggestion de cartons en cours…</p>}
        {detailError.has(order.id) && <p role="alert" className="mt-2 text-red-700">Suggestion indisponible. <button type="button" onClick={() => void loadDetail(order.id)} className="font-semibold underline">Réessayer</button></p>}
        {loaded?.suggestion && <div className="mt-2"><p className="font-semibold">Cartons suggérés</p>{loaded.suggestion.parcels.map((parcel, index) => <p key={index}>Colis {index + 1} : {parcel.carton?.name ?? 'Aucun profil adapté'} · {(parcel.weightG / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg</p>)}</div>}
        {loaded && loaded.missingWeightLines > 0 && <p className="mt-2 font-semibold text-amber-800 dark:text-amber-300">{loaded.missingWeightLines} ligne(s) sans poids produit.</p>}
      </section>
      <section aria-label={order.fulfillment_type === 'pickup' ? 'Retrait' : 'Expédition'}><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">{order.fulfillment_type === 'pickup' ? 'Retrait' : 'Expédition'}</h3>
        {order.fulfillment_type === 'pickup'
          ? <div className="space-y-1"><p>Retrait magasin</p>{operation.urgency && <p className="font-semibold text-amber-800 dark:text-amber-300">{operation.urgency}</p>}{order.email && <p>Contact : <a href={`mailto:${order.email}`} className="underline">{order.email}</a></p>}</div>
          : <div className="space-y-1">
            <p>{compactAddress(order) || 'Destination indisponible'}</p>
            {(carrierOf(order) || order.shipping_details?.serviceName) && <p>{[carrierOf(order), order.shipping_details?.serviceName].filter(Boolean).join(' · ')}</p>}
            {order.shipping_provider_key && <p>Provider : {order.shipping_provider_key}</p>}
            {order.shipping_provider_reference && copyable('Réf.', order.shipping_provider_reference)}
            {order.tracking_code && copyable('Suivi', order.tracking_code)}
            <p>Transport : {transportState(order)?.label}{order.shipping_provider_synced_at ? <span className="text-gray-500"> · synchro {formatSince(order.shipping_provider_synced_at, now)}</span> : null}</p>
            {lastMove && <p>Dernier mouvement : {shipmentDate(lastMove)}</p>}
            {eta && <p>Livraison estimée : {eta}</p>}
          </div>}
      </section>
      <section aria-label="Actions"><h3 className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Actions</h3><div className="flex flex-col items-stretch gap-2 sm:items-start">
        {/* Action rapide au format par défaut du tenant ; le choix ponctuel A5/A4 reste dans le détail et « Documents… ». */}
        {order.status !== 'cancelled' && <a href={`/api/admin/orders/${order.id}/documents/picking-list`} target="_blank" rel="noopener noreferrer" className={detailButton}><IconPrinter size={15} aria-hidden="true" /> Liste de préparation · {ORDER_DOCUMENT_FORMATS[documentDefaults.pickingFormat].label}<span className="sr-only"> (PDF, nouvel onglet)</span></a>}
        {order.status !== 'cancelled' && order.fulfillment_type === 'delivery' && documentDefaults.packingSlipEnabled && <a href={`/api/admin/orders/${order.id}/documents/packing-slip`} target="_blank" rel="noopener noreferrer" className={detailButton}><IconFileTypePdf size={15} aria-hidden="true" /> Bon de colis · {ORDER_DOCUMENT_FORMATS[documentDefaults.packingSlipFormat].label}<span className="sr-only"> (PDF, nouvel onglet)</span></a>}
        <Link href={`/admin/orders/${order.id}`} className={detailButton}>Voir la commande</Link>
        {trackingUrl && <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className={detailButton}>Voir le suivi transporteur <IconExternalLink size={13} aria-hidden="true" /></a>}
      </div></section>
    </div>;
  }

  function preparationSummary(order: ListOrder, compact = false) {
    const count = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
    const cold = coldSummary(order);
    return <>
      <p className="flex flex-wrap items-center gap-x-2 text-xs"><b>{count} unité{count !== 1 ? 's' : ''}</b>
        {compact && weightLabel(order) && <span className="text-gray-500">· {weightLabel(order)}</span>}
        {cold.fresh > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"><IconTemperature size={12} aria-hidden="true" />{cold.fresh} frais</span>}
        {cold.frozen > 0 && <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300"><IconSnowflake size={12} aria-hidden="true" />{cold.frozen} surgelé{cold.frozen > 1 ? 's' : ''}</span>}
      </p>
      {order.order_items.slice(0, 2).map(item => <p key={item.id} className="truncate text-xs text-gray-600 dark:text-gray-300">×{item.quantity} {item.name}</p>)}
      {order.order_items.length > 2 && <p className="text-[11px] text-gray-400">+{order.order_items.length - 2} autre{order.order_items.length - 2 > 1 ? 's' : ''}</p>}
    </>;
  }

  const rowAccent = (operation: OrderOperation) => operation.group === 'action_required'
    ? 'border-l-4 border-l-rose-500'
    : ['preparation_overdue', 'pickup_overdue'].includes(operation.group)
      ? 'border-l-4 border-l-amber-500'
      : operation.handling.score === 3
        ? 'border-l-4 border-l-violet-500'
        : 'border-l-4 border-l-transparent';
  const showGroups = sort === 'priority';
  const ariaSort = sort === 'newest' ? 'descending' : sort === 'oldest' ? 'ascending' : sort === 'priority' ? 'other' : 'none';

  if (!orders.length) return <div className="rounded-2xl border border-[var(--admin-border)] bg-white px-4 py-12 text-center text-sm text-gray-500 dark:bg-gray-900">Aucune commande pour ces filtres. <Link href="/admin" className="font-semibold text-[var(--admin-primary-fg)] underline">Voir toutes les commandes</Link></div>;
  return <div>
    <AdminOrdersPoller onNewOrders={onNewOrders} isEditing={pendingTracking !== null || expanded.size > 0} />
    <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:bg-gray-900">
      <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
        <caption className="sr-only">Commandes, triées par {sort === 'priority' ? 'priorité opérationnelle' : sort === 'newest' ? 'date décroissante' : sort === 'oldest' ? 'date croissante' : 'montant'}</caption>
        <thead><tr className="border-b border-gray-100 bg-gray-50 text-left text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:bg-gray-800">
          <th scope="col" className="w-10 p-3"><input type="checkbox" checked={selected.size === orders.length} onChange={() => setSelected(selected.size === orders.length ? new Set() : new Set(orders.map(order => order.id)))} aria-label="Sélectionner les commandes de cette page" /></th>
          <th scope="col" className="p-3 text-gray-800 dark:text-gray-200" aria-sort={ariaSort}>Commande</th><th scope="col" className="p-3">À préparer</th><th scope="col" className="p-3">Livraison / Retrait</th><th scope="col" className="p-3">État</th><th scope="col" className="p-3 text-right">Action</th>
        </tr></thead>
        <tbody>{orders.map((order, index) => {
          const operation = operationOf(order);
          const open = expanded.has(order.id);
          const isDone = done(order);
          const header = showGroups && (index === 0 || operationOf(orders[index - 1]!).group !== operation.group);
          return <Fragment key={order.id}>
            {header && <tr className="border-b border-gray-100 dark:border-gray-800"><th scope="rowgroup" colSpan={6} className={`bg-gray-50/70 px-3 py-1.5 text-left text-[11px] font-semibold dark:bg-gray-800/50 ${operation.group === 'action_required' ? 'text-red-700 dark:text-red-300' : ['preparation_overdue', 'pickup_overdue'].includes(operation.group) ? 'text-amber-800 dark:text-amber-300' : 'text-gray-500 dark:text-gray-400'}`}>{PRIORITY_GROUP_LABELS[operation.group]}</th></tr>}
            <tr className={`border-b border-gray-100 align-top dark:border-gray-800 ${rowAccent(operation)} ${isDone ? 'text-gray-500 [&_b]:font-medium' : 'hover:bg-violet-50/60 dark:hover:bg-violet-900/10'}`}>
              <td className="p-3"><input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleSelect(order.id)} aria-label={`Sélectionner ${shortId(order.id)}`} /></td>
              <td className="p-3">
                <button type="button" onClick={() => toggleDetail(order)} aria-expanded={open} aria-controls={`order-detail-${order.id}`} className="-m-1 flex items-start gap-1 rounded-lg p-1 text-left hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:hover:bg-gray-800">
                  {open ? <IconChevronDown size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" /> : <IconChevronRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-400" />}
                  <span className="min-w-0"><span className="font-mono text-xs font-bold text-gray-900 dark:text-gray-100">{shortId(order.id)}</span><span className="sr-only"> — {open ? 'masquer' : 'afficher'} le détail</span>
                    <span className="block max-w-[170px] truncate font-semibold">{order.full_name ?? order.email ?? 'Client'}</span></span>
                </button>
                <p className="mt-0.5 pl-5 text-xs font-medium text-gray-600 dark:text-gray-300">{formatOrderDate(order.created_at)} · {money.format(Number(order.total ?? 0))}</p>
                {operation.urgency && <p className="mt-1 flex items-start gap-1 pl-5 text-[11px] font-semibold text-amber-800 dark:text-amber-300"><IconAlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />{operation.urgency}</p>}
              </td>
              <td className="max-w-[220px] p-3">{preparationSummary(order)}{handlingBadges(operation)}</td>
              <td className="p-3">{fulfillmentCell(order)}</td>
              <td className="p-3">{stateCell(order, operation)}</td>
              <td className="p-3 text-right">{actionLink(order, operation)}</td>
            </tr>
            {open && <tr><td colSpan={6} className="p-3">{detailPanel(order, operation)}</td></tr>}
          </Fragment>;
        })}</tbody>
      </table></div>

      <ul className="divide-y divide-gray-100 dark:divide-gray-800 md:hidden" aria-label="Commandes">{orders.map((order, index) => {
        const operation = operationOf(order);
        const open = expanded.has(order.id);
        const header = showGroups && (index === 0 || operationOf(orders[index - 1]!).group !== operation.group);
        const flag = operation.urgency ?? operation.anomaly?.label ?? null;
        return <li key={order.id}>
          {header && <p className="bg-gray-50 px-4 py-1.5 text-[11px] font-semibold text-gray-500 dark:bg-gray-800/60 dark:text-gray-400">{PRIORITY_GROUP_LABELS[operation.group]}</p>}
          <div className={`border-l-4 p-3 ${rowAccent(operation)} ${done(order) ? 'text-gray-500' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><b className="font-mono text-xs">{shortId(order.id)}</b><p className="truncate font-semibold">{order.full_name ?? order.email ?? 'Client'}</p><p className="text-xs font-medium text-gray-600 dark:text-gray-300">{formatOrderDate(order.created_at)} · {money.format(Number(order.total ?? 0))}</p></div>
              {flag && <span className="inline-flex max-w-[45%] items-start gap-1 text-right text-[11px] font-semibold text-amber-800 dark:text-amber-300"><IconAlertTriangle size={13} aria-hidden="true" className="mt-px shrink-0" />{flag}</span>}
            </div>
            <div className="mt-2">{preparationSummary(order, true)}{handlingBadges(operation)}</div>
            <div className="mt-2">{fulfillmentCell(order)}</div>
            <div className="mt-2">{stateCell(order, operation)}</div>
            <div className="mt-3 flex gap-2">
              <div className="flex-1">{actionLink(order, operation, true)}</div>
              <button type="button" onClick={() => toggleDetail(order)} aria-expanded={open} aria-controls={`order-detail-${order.id}`} aria-label={`${open ? 'Masquer' : 'Afficher'} le détail de ${shortId(order.id)}`}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--admin-border)] text-gray-600 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:text-gray-300">{open ? <IconChevronDown size={16} aria-hidden="true" className="rotate-180" /> : <IconChevronDown size={16} aria-hidden="true" />}</button>
            </div>
            {open && <div className="mt-3">{detailPanel(order, operation)}</div>}
          </div>
        </li>;
      })}</ul>
    </div>
    {selected.size > 0 && <div role="toolbar" aria-label="Actions groupées" className="sticky bottom-4 z-20 mx-auto mt-4 flex max-w-fit flex-wrap items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 text-white shadow-lg"><span className="text-xs font-bold">{selected.size} sélectionnée(s)</span><button type="button" onClick={exportCsv} className="min-h-9 text-xs underline">Exporter CSV</button><button type="button" onClick={() => setDocumentsOpen(true)} className="min-h-9 text-xs underline">Documents…</button>{canManage && <button type="button" onClick={() => void handleBulk()} className="min-h-9 text-xs underline">Traiter la sélection</button>}<button type="button" onClick={() => setSelected(new Set())} aria-label="Annuler la sélection" className="min-h-9 min-w-9"><IconX size={16} aria-hidden="true" /></button></div>}
    {documentsOpen && <BulkDocumentsDialog orderIds={orders.filter((order) => selected.has(order.id)).map((order) => order.id)} defaults={documentDefaults} onClose={() => setDocumentsOpen(false)} />}
    {pendingTracking && <BulkTrackingModal orders={pendingTracking} carrierOptions={carriers} onCancel={() => setPendingTracking(null)} onConfirm={tracking => { void handleBulk(tracking); }} />}
    {toast && <div role="status" className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-white shadow-lg ${toast.type === 'success' ? 'bg-emerald-700' : 'bg-red-700'}`}>{toast.type === 'success' ? <IconCheck size={16} aria-hidden="true" /> : <IconX size={16} aria-hidden="true" />}{toast.msg}</div>}
  </div>;
}
