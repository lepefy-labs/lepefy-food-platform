'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertTriangle, IconBuildingStore, IconChevronDown, IconChevronRight, IconDownload, IconExternalLink,
  IconFileTypePdf, IconLeaf, IconPrinter, IconSnowflake, IconTruck, IconTruckDelivery,
} from '@tabler/icons-react';
import { ORDER_DOCUMENT_FORMATS } from '@/lib/orders/documents/formats';
import {
  classifyOrderOperation, formatSince, lastTrackingEventAt, PRIORITY_GROUP_LABELS, transportState,
  type OperationalThresholds, type OrderOperation, type OrderSortKey,
} from '@/lib/orders/adminOrderOperations';
import { carrierDisplayName, safeShipmentTrackingUrl, shipmentDate } from '@/lib/shipping/shipmentPresentation';
import type { CartonSuggestion } from '@/lib/shipping/cartonSuggestion';
import type { NormalizedShipmentStatus, OrderStatus, ShipmentTrackingEvent } from '@lepefy/types';
import { formatDate, formatMoney, formatWeight } from '@/lib/admin/format';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import Badge from '../_components/ui/Badge';
import Button, { ButtonAnchor, buttonClasses } from '../_components/ui/Button';
import ConfirmDialog from '../_components/ui/ConfirmDialog';
import CopyableValue from '../_components/ui/CopyableValue';
import StatusBadge from '../_components/ui/StatusBadge';
import { useAdminToast } from '../_components/ui/Toaster';
import BulkTrackingModal, { type PendingTrackingOrder } from '../_components/ui/BulkTrackingModal';
import DataTable, { type DataColumn, type DataRowGroup } from '../_components/data/DataTable';
import { BulkBar, RowSelectionProvider } from '../_components/data/RowSelection';
import { EmptyState } from '../_components/ui/States';
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
  /** Link that clears every filter (empty state). */
  resetHref: string;
  hasFilters: boolean;
  /** Start with the « Terminées » group collapsed (work queue without search, status filter or « Terminés » view). */
  finishedCollapsed: boolean;
}

const shortId = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;
function compactAddress(order: ListOrder) {
  const address = order.shipping_address;
  return [address?.postal_code, address?.city, address?.country].filter(Boolean).join(' ');
}
function parcelCount(order: ListOrder) { return order.packing_parcel_count ?? order.shipping_details?.numParcels ?? null; }
function weightLabel(order: ListOrder) {
  const weight = order.shipping_details?.totalWeightG;
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0 ? formatWeight(weight) : null;
}
function carrierOf(order: ListOrder) { return carrierDisplayName(order.tracking_carrier ?? order.shipping_details?.carrierName); }
function coldSummary(order: ListOrder) {
  return order.order_items.reduce((total, item) => {
    if (item.storage_type === 'fresh') total.fresh += item.quantity;
    if (item.storage_type === 'frozen') total.frozen += item.quantity;
    return total;
  }, { fresh: 0, frozen: 0 });
}
function formatEta(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' }).format(new Date(value)) : null;
}

const GROUP_TONE: Partial<Record<OrderOperation['group'], AdminTone>> = {
  action_required: 'danger', preparation_overdue: 'urgent', pickup_overdue: 'urgent', finished: 'neutral',
};

function rowToneOf(operation: OrderOperation): AdminTone | undefined {
  if (operation.group === 'action_required') return 'danger';
  if (operation.group === 'preparation_overdue' || operation.group === 'pickup_overdue') return 'urgent';
  if (operation.handling.score === 3) return 'warning';
  return undefined;
}

function HandlingBadges({ operation }: { operation: OrderOperation }) {
  const { international, fresh, frozen, score } = operation.handling;
  if (!international && !fresh && !frozen) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1" aria-label="Attention logistique">
      {score === 3 && <Badge tone="danger">Priorité élevée</Badge>}
      {international && <Badge tone="info">International</Badge>}
      {fresh && <Badge tone="success" icon={<IconLeaf size={12} aria-hidden="true" />}>Produits frais</Badge>}
      {frozen && <Badge tone="info" icon={<IconSnowflake size={12} aria-hidden="true" />}>Surgelés</Badge>}
    </span>
  );
}

function csvOf(rows: ListOrder[]) {
  const cell = (value: unknown) => `"${String(value ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  const lines = [['Commande', 'Date', 'Client', 'E-mail', 'Total', 'Statut', 'Paiement', 'Transporteur'].map(cell).join(';'),
    ...rows.map(order => [shortId(order.id), formatDate(order.created_at, 'datetime'), order.full_name, order.email, Number(order.total ?? 0).toFixed(2).replace('.', ','), order.status, order.payment_method, carrierOf(order)].map(cell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

export default function OrdersTable({ orders, tenantCurrency, carriers, thresholds, canManage, managedProviderAvailable, nowIso, originCountry, sort, documentDefaults, resetHref, hasFilters, finishedCollapsed }: Props) {
  const router = useRouter();
  const toast = useAdminToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Finished orders need no action: in the work queue their group starts
  // collapsed (count kept visible); a search, a status filter or the
  // « Terminés » view opens it. The choice survives polling refreshes.
  const [finishedOpen, setFinishedOpen] = useState(!finishedCollapsed);
  useEffect(() => { setFinishedOpen(!finishedCollapsed); }, [finishedCollapsed]);
  const [detail, setDetail] = useState<Record<string, DetailData>>({});
  const [detailError, setDetailError] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [documentIds, setDocumentIds] = useState<string[] | null>(null);
  const [bulkIds, setBulkIds] = useState<string[] | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const money = (value: number | null | undefined) => formatMoney(Number(value ?? 0), tenantCurrency || 'EUR');
  const operations = useMemo(() => new Map(orders.map(order => [order.id, classifyOrderOperation({ ...order, originCountry, managedProviderAvailable }, thresholds, now)])), [orders, managedProviderAvailable, thresholds, now]);
  // Rows of the collapsed « Terminées » group are off screen: they leave the selection (bulk actions never touch hidden orders).
  const rowIds = useMemo(() => orders.filter(order => finishedOpen || sort !== 'priority' || operations.get(order.id)?.group !== 'finished').map(order => order.id), [orders, finishedOpen, sort, operations]);
  useEffect(() => { setExpanded(new Set()); setDetail({}); setDetailError(new Set()); }, [orders]);

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
  function exportSelection(ids: string[]) {
    const url = URL.createObjectURL(new Blob([csvOf(orders.filter(order => ids.includes(order.id)))], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `commandes_selection_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  async function handleBulk(ids: string[], tracking?: Record<string, { carrier: string; code: string }>) {
    setBulkPending(true);
    try {
      const response = await fetch('/api/admin/orders/bulk-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: ids, tracking }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Erreur de mise à jour.');
      const missing = (body.skipped ?? []).filter((entry: { reason: string }) => entry.reason === 'missing_tracking');
      if (missing.length && !tracking) setPendingTracking(missing.map((entry: { id: string }) => ({ id: entry.id, label: shortId(entry.id) })));
      else setPendingTracking(null);
      toast.success(`${body.shipped.length} expédiée(s) · ${body.readyForPickup.length} prête(s) au retrait`, missing.length && !tracking ? { description: `${missing.length} commande(s) attendent un code de suivi.` } : undefined);
      setBulkIds(null);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erreur de mise à jour.');
    } finally {
      setBulkPending(false);
    }
  }
  const onNewOrders = useCallback((newOrders: { id: string }[]) => {
    if (!newOrders.length) return;
    toast.info(`${newOrders.length} nouvelle(s) commande(s)`, { action: { label: 'Voir', href: `/admin/orders/${newOrders[0]!.id}` } });
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('Nouvelle commande', { body: `Commande ${shortId(newOrders[0]!.id)}` });
  }, [toast]);

  const operationOf = (order: ListOrder) => operations.get(order.id)!;
  const done = (order: ListOrder) => operationOf(order).group === 'finished';

  function fulfillmentCell(order: ListOrder) {
    if (order.fulfillment_type === 'pickup') return <p className="inline-flex items-center gap-1.5 font-semibold"><IconBuildingStore size={16} aria-hidden="true" /> Retrait magasin</p>;
    const carrier = carrierOf(order);
    const meta = [carrier, parcelCount(order) != null && `${parcelCount(order)} colis`, weightLabel(order)].filter(Boolean).join(' · ');
    return (
      <div className="max-w-[240px] space-y-0.5">
        <p className="flex items-center gap-1.5"><IconTruck size={16} aria-hidden="true" className="shrink-0" /><b className="font-semibold">Livraison</b><span className="truncate text-a-text-2">· {compactAddress(order) || 'Destination indisponible'}</span></p>
        {meta && <p className="truncate text-xs text-a-text-3">{meta}</p>}
        {order.shipping_provider_reference && <CopyableValue label="Réf." value={order.shipping_provider_reference} />}
        {order.tracking_code && order.tracking_code !== order.shipping_provider_reference && <CopyableValue label="Suivi" value={order.tracking_code} />}
      </div>
    );
  }

  function stateCell(order: ListOrder, operation: OrderOperation) {
    const transport = transportState(order);
    const lastMove = lastTrackingEventAt(order);
    const eta = order.status === 'shipped' ? formatEta(order.shipping_estimated_delivery_at) : null;
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusBadge status={order.status} fulfillmentType={order.fulfillment_type} />
        {transport && !done(order) && <Badge tone={transport.tone}>Transport : {transport.label}</Badge>}
        {lastMove && order.status === 'shipped' && <p className="text-xs text-a-text-3">Mouvement {formatSince(lastMove, now)}</p>}
        {eta && <p className="text-xs text-a-text-3">Livraison estimée : {eta}</p>}
        {operation.anomaly && (
          <p className={cn('flex items-start gap-1 text-xs font-semibold', operation.flags.has('incidents') || operation.anomaly.code === 'stock_conflict' ? 'text-tone-danger-fg' : 'text-tone-urgent-fg')}>
            <IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{operation.anomaly.label}
          </p>
        )}
        {operation.notice && <p className="flex items-start gap-1 text-xs font-semibold text-tone-warning-fg"><IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{operation.notice}</p>}
        {/* Below 2xl the action column is hidden and the action sits under the state, so the row fits without horizontal scroll. */}
        <div className="mt-1 2xl:hidden">{actionLink(order, operation)}</div>
      </div>
    );
  }

  function actionLink(order: ListOrder, operation: OrderOperation, full = false) {
    const { action } = operation;
    const label = canManage || action.intent === 'tracking' ? action.label : 'Voir la commande';
    const trackingUrl = action.intent === 'tracking' ? safeShipmentTrackingUrl(order.shipping_tracking_url) : null;
    const variant = done(order) ? 'ghost' : action.primary && (canManage || action.intent === 'tracking') ? 'outline' : 'secondary';
    // In the table the label may wrap on two lines: a long action (« Poursuivre la préparation »)
    // must not push the row wider than the page and hide the button behind a horizontal scroll.
    const className = buttonClasses({ variant, size: 'sm', className: full ? 'w-full' : 'w-[9.5rem] !whitespace-normal py-1 text-center leading-tight' });
    if (trackingUrl) return <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className={className}>{label}<IconExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (suivi transporteur, nouvel onglet) — commande {shortId(order.id)}</span></a>;
    return <Link href={`/admin/orders/${order.id}`} className={className}>{label}<span className="sr-only"> — commande {shortId(order.id)}</span></Link>;
  }

  function detailPanel(order: ListOrder, operation: OrderOperation) {
    const loaded = detail[order.id];
    const trackingUrl = safeShipmentTrackingUrl(order.shipping_tracking_url);
    const lastMove = lastTrackingEventAt(order);
    const eta = formatEta(order.shipping_estimated_delivery_at);
    const heading = 'mb-2 text-xs font-semibold text-a-text-2';
    return (
      <div id={`order-detail-${order.id}`} className="grid gap-4 p-4 text-sm text-a-text md:grid-cols-3">
        <section aria-label="Préparation"><h3 className={heading}>Préparation</h3>
          <ul className="space-y-1">{order.order_items.map(item => <li key={item.id}><b className="font-semibold">×{item.quantity}</b> {item.name}{item.warehouse_location ? <span className="text-a-text-3"> · {item.warehouse_location}</span> : null}</li>)}</ul>
          {(weightLabel(order) || parcelCount(order) != null) && <p className="mt-2 text-a-text-2">{[weightLabel(order) && `Poids total ${weightLabel(order)}`, parcelCount(order) != null && `${parcelCount(order)} colis`].filter(Boolean).join(' · ')}</p>}
          {loading.has(order.id) && <p role="status" className="mt-2 text-a-text-3">Suggestion de cartons en cours…</p>}
          {detailError.has(order.id) && <p role="alert" className="mt-2 text-tone-danger-fg">Suggestion indisponible. <button type="button" onClick={() => void loadDetail(order.id)} className="font-semibold underline">Réessayer</button></p>}
          {loaded?.suggestion && <div className="mt-2"><p className="font-semibold">Cartons suggérés</p>{loaded.suggestion.parcels.map((parcel, index) => <p key={index}>Colis {index + 1} : {parcel.carton?.name ?? 'Aucun profil adapté'} · {formatWeight(parcel.weightG)}</p>)}</div>}
          {loaded && loaded.missingWeightLines > 0 && <p className="mt-2 font-semibold text-tone-warning-fg">{loaded.missingWeightLines} ligne(s) sans poids produit.</p>}
        </section>
        <section aria-label={order.fulfillment_type === 'pickup' ? 'Retrait' : 'Expédition'}><h3 className={heading}>{order.fulfillment_type === 'pickup' ? 'Retrait' : 'Expédition'}</h3>
          {order.fulfillment_type === 'pickup'
            ? <div className="space-y-1"><p>Retrait magasin</p>{operation.urgency && <p className="font-semibold text-tone-urgent-fg">{operation.urgency}</p>}{order.email && <p>Contact : <a href={`mailto:${order.email}`} className="underline">{order.email}</a></p>}</div>
            : <div className="space-y-1">
              <p>{compactAddress(order) || 'Destination indisponible'}</p>
              {(carrierOf(order) || order.shipping_details?.serviceName) && <p>{[carrierOf(order), order.shipping_details?.serviceName].filter(Boolean).join(' · ')}</p>}
              {order.shipping_provider_key && <p>Provider : {order.shipping_provider_key}</p>}
              {order.shipping_provider_reference && <CopyableValue label="Réf." value={order.shipping_provider_reference} />}
              {order.tracking_code && <CopyableValue label="Suivi" value={order.tracking_code} />}
              <p>Transport : {transportState(order)?.label}{order.shipping_provider_synced_at ? <span className="text-a-text-3"> · synchro {formatSince(order.shipping_provider_synced_at, now)}</span> : null}</p>
              {lastMove && <p>Dernier mouvement : {shipmentDate(lastMove)}</p>}
              {eta && <p>Livraison estimée : {eta}</p>}
            </div>}
        </section>
        <section aria-label="Actions"><h3 className={heading}>Actions</h3>
          <div className="flex flex-col items-stretch gap-2 sm:items-start">
            {/* Action rapide au format par défaut du tenant ; le choix ponctuel A5/A4 reste dans le détail et « Documents… ». */}
            {order.status !== 'cancelled' && <ButtonAnchor href={`/api/admin/orders/${order.id}/documents/picking-list`} target="_blank" rel="noopener noreferrer"><IconPrinter size={16} aria-hidden="true" /> Liste de préparation · {ORDER_DOCUMENT_FORMATS[documentDefaults.pickingFormat].label}<span className="sr-only"> (PDF, nouvel onglet)</span></ButtonAnchor>}
            {order.status !== 'cancelled' && order.fulfillment_type === 'delivery' && documentDefaults.packingSlipEnabled && <ButtonAnchor href={`/api/admin/orders/${order.id}/documents/packing-slip`} target="_blank" rel="noopener noreferrer"><IconFileTypePdf size={16} aria-hidden="true" /> Bon de colis · {ORDER_DOCUMENT_FORMATS[documentDefaults.packingSlipFormat].label}<span className="sr-only"> (PDF, nouvel onglet)</span></ButtonAnchor>}
            <Link href={`/admin/orders/${order.id}`} className={buttonClasses({ variant: 'secondary' })}>Voir la commande</Link>
            {trackingUrl && <ButtonAnchor href={trackingUrl} target="_blank" rel="noopener noreferrer">Voir le suivi transporteur <IconExternalLink size={14} aria-hidden="true" /></ButtonAnchor>}
          </div>
        </section>
      </div>
    );
  }

  function preparationSummary(order: ListOrder, compact = false) {
    const count = order.order_items.reduce((sum, item) => sum + item.quantity, 0);
    const cold = coldSummary(order);
    return <>
      <p className="flex flex-wrap items-center gap-x-2"><b className="font-semibold">{count} unité{count !== 1 ? 's' : ''}</b>
        {compact && weightLabel(order) && <span className="text-a-text-3">· {weightLabel(order)}</span>}
        {cold.fresh > 0 && <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-tone-success-fg"><IconLeaf size={13} aria-hidden="true" />{cold.fresh} frais</span>}
        {cold.frozen > 0 && <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-tone-info-fg"><IconSnowflake size={13} aria-hidden="true" />{cold.frozen} surgelé{cold.frozen > 1 ? 's' : ''}</span>}
      </p>
      {order.order_items.slice(0, 2).map(item => <p key={item.id} className="truncate text-xs text-a-text-2">×{item.quantity} {item.name}</p>)}
      {order.order_items.length > 2 && <p className="text-xs text-a-text-3">+{order.order_items.length - 2} autre{order.order_items.length - 2 > 1 ? 's' : ''}</p>}
    </>;
  }

  const columns: DataColumn<ListOrder>[] = [
    {
      key: 'order', header: 'Commande', className: 'min-w-[200px]',
      cell: (order) => {
        const operation = operationOf(order);
        const open = expanded.has(order.id);
        return <>
          <button type="button" onClick={() => toggleDetail(order)} aria-expanded={open} aria-controls={`order-detail-${order.id}`}
            className="-m-1 flex items-start gap-1 rounded-lg p-1 text-left hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
            {open ? <IconChevronDown size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-a-text-3" /> : <IconChevronRight size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-a-text-3" />}
            <span className="min-w-0">
              <span className="font-mono text-xs font-semibold text-a-text-2">{shortId(order.id)}</span><span className="sr-only"> — {open ? 'masquer' : 'afficher'} le détail</span>
              <span className="block max-w-[200px] truncate font-semibold">{order.full_name ?? order.email ?? 'Client'}</span>
            </span>
          </button>
          <p className="mt-0.5 pl-5 text-xs text-a-text-3"><time dateTime={order.created_at}>{formatDate(order.created_at, 'datetime')}</time></p>
          {operation.urgency && <p className="mt-1 flex items-start gap-1 pl-5 text-xs font-semibold text-tone-urgent-fg"><IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{operation.urgency}</p>}
        </>;
      },
    },
    { key: 'items', header: 'À préparer', className: 'max-w-[220px]', cell: (order) => <>{preparationSummary(order)}<HandlingBadges operation={operationOf(order)} /></> },
    { key: 'fulfillment', header: 'Livraison / Retrait', cell: fulfillmentCell },
    { key: 'state', header: 'État', cell: (order) => stateCell(order, operationOf(order)) },
    { key: 'total', header: 'Total', align: 'right', cell: (order) => <span className="font-semibold">{money(order.total)}</span> },
    { key: 'action', header: <span className="sr-only">Action</span>, align: 'right', hideBelow: '2xl', cell: (order) => actionLink(order, operationOf(order)) },
  ];

  const groups: DataRowGroup<ListOrder>[] | undefined = sort === 'priority'
    ? orders.reduce<DataRowGroup<ListOrder>[]>((runs, order) => {
      const group = operationOf(order).group;
      const last = runs[runs.length - 1];
      if (last && last.id.startsWith(`${group}:`)) last.rows.push(order);
      else runs.push({
        id: `${group}:${runs.length}`, label: PRIORITY_GROUP_LABELS[group], tone: GROUP_TONE[group], rows: [order],
        ...(group === 'finished' ? { collapsed: !finishedOpen, onToggle: () => setFinishedOpen((open) => !open) } : {}),
      });
      return runs;
    }, [])
    : undefined;

  function mobileCard(order: ListOrder) {
    const operation = operationOf(order);
    const open = expanded.has(order.id);
    const flag = operation.urgency ?? operation.anomaly?.label ?? null;
    return (
      <div className={cn('p-3 pl-4 text-sm', done(order) && 'text-a-text-2')}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <span className="font-mono text-xs font-semibold text-a-text-2">{shortId(order.id)}</span>
            <p className="truncate font-semibold">{order.full_name ?? order.email ?? 'Client'}</p>
            <p className="text-xs text-a-text-3">{formatDate(order.created_at, 'datetime')} · <b className="font-semibold text-a-text">{money(order.total)}</b></p>
          </div>
          <StatusBadge status={order.status} fulfillmentType={order.fulfillment_type} />
        </div>
        {flag && <p className="mt-1.5 flex items-start gap-1 text-xs font-semibold text-tone-urgent-fg"><IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{flag}</p>}
        <div className="mt-2">{preparationSummary(order, true)}<HandlingBadges operation={operation} /></div>
        <div className="mt-2">{fulfillmentCell(order)}</div>
        <div className="mt-3 flex gap-2">
          <div className="flex-1">{actionLink(order, operation, true)}</div>
          <Button variant="secondary" size="sm" onClick={() => toggleDetail(order)} aria-expanded={open} aria-controls={`order-detail-${order.id}`} aria-label={`${open ? 'Masquer' : 'Afficher'} le détail de ${shortId(order.id)}`}>
            <IconChevronDown size={16} aria-hidden="true" className={open ? 'rotate-180' : undefined} />
          </Button>
        </div>
        {open && <div className="-mx-3 mt-3 border-t border-a-border bg-a-surface-2">{detailPanel(order, operation)}</div>}
      </div>
    );
  }

  return (
    <RowSelectionProvider rowIds={rowIds}>
      <AdminOrdersPoller onNewOrders={onNewOrders} isEditing={pendingTracking !== null || expanded.size > 0 || bulkIds !== null} />
      <DataTable<ListOrder>
        caption={`Commandes, triées par ${sort === 'priority' ? 'priorité opérationnelle' : sort === 'newest' ? 'date décroissante' : sort === 'oldest' ? 'date croissante' : 'montant'}`}
        columns={columns}
        rowKey={(order) => order.id}
        rows={orders}
        groups={groups}
        rowTone={(order) => rowToneOf(operationOf(order))}
        rowClassName={(order) => (done(order) ? 'text-a-text-2' : undefined)}
        selectable={{ label: (order) => `Sélectionner ${shortId(order.id)}` }}
        rowDetail={(order) => (expanded.has(order.id) ? detailPanel(order, operationOf(order)) : null)}
        mobileCard={mobileCard}
        empty={hasFilters
          ? <EmptyState variant="filtered" title="Aucune commande ne correspond à ces filtres." description="Modifiez la recherche ou les filtres pour élargir la liste." action={<Link href={resetHref} className={buttonClasses({ variant: 'secondary' })}>Effacer les filtres</Link>} />
          : <EmptyState title="Aucune commande pour le moment." description="Les nouvelles commandes de la boutique apparaîtront ici." />}
      />
      <BulkBar rowIds={rowIds}>
        {(ids) => <>
          <Button variant="secondary" size="sm" onClick={() => setDocumentIds(ids)}><IconPrinter size={16} aria-hidden="true" />Documents…</Button>
          <Button variant="secondary" size="sm" onClick={() => exportSelection(ids)}><IconDownload size={16} aria-hidden="true" />Exporter (CSV)</Button>
          {canManage && <Button size="sm" onClick={() => setBulkIds(ids)}><IconTruckDelivery size={16} aria-hidden="true" />Traiter la sélection</Button>}
        </>}
      </BulkBar>
      {documentIds && <BulkDocumentsDialog orderIds={documentIds} defaults={documentDefaults} onClose={() => setDocumentIds(null)} />}
      <ConfirmDialog
        open={bulkIds !== null}
        title={`Traiter ${bulkIds?.length ?? 0} commande${(bulkIds?.length ?? 0) > 1 ? 's' : ''} ?`}
        description="Seules les commandes « En préparation » sont traitées : les livraisons passent en « Expédié » (un code de suivi est demandé s’il manque) et les retraits en « Prêt à retirer », avec les mêmes effets qu’un changement de statut un par un. Les autres commandes sont ignorées."
        confirmLabel="Traiter la sélection"
        loading={bulkPending}
        onConfirm={() => { if (bulkIds) void handleBulk(bulkIds); }}
        onCancel={() => setBulkIds(null)}
      />
      {pendingTracking && <BulkTrackingModal orders={pendingTracking} carrierOptions={carriers} onCancel={() => setPendingTracking(null)} onConfirm={tracking => { void handleBulk(Object.keys(tracking), tracking); }} />}
    </RowSelectionProvider>
  );
}
