'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  IconAlertOctagon, IconAlertTriangle, IconBuildingStore, IconChevronDown, IconCircleCheck, IconClipboardList, IconClockExclamation,
  IconClockHour4, IconDotsVertical, IconDownload, IconExternalLink, IconEye, IconFileTypePdf, IconLeaf, IconPackage, IconPrinter,
  IconSnowflake, IconTruck, IconTruckDelivery, type Icon as TablerIcon,
} from '@tabler/icons-react';
import { ORDER_DOCUMENT_FORMATS } from '@/lib/orders/documents/formats';
import {
  classifyOrderOperation, formatSince, lastTrackingEventAt, PRIORITY_GROUP_LABELS, transportState,
  type OperationalThresholds, type OrderOperation, type OrderSortKey, type PriorityGroup,
} from '@/lib/orders/adminOrderOperations';
import {
  defaultGroupCollapsed, groupCountLabel, orderActionEmphasis, PRIORITY_GROUP_TONE, queueGroupContextKey, type QueueGroupContext,
} from '@/lib/orders/orderQueuePresentation';
import { carrierDisplayName, carrierTrackingLink, shipmentDate } from '@/lib/shipping/shipmentPresentation';
import type { CartonSuggestion } from '@/lib/shipping/cartonSuggestion';
import type { NormalizedShipmentStatus, OrderStatus, ShipmentTrackingEvent } from '@lepefy/types';
import { formatDate, formatMoney, formatWeight } from '@/lib/admin/format';
import type { AdminTone } from '@/lib/admin/tokens';
import { cn } from '@/lib/utils/cn';
import Badge from '../../_components/ui/Badge';
import Button, { ButtonAnchor, buttonClasses } from '../../_components/ui/Button';
import ConfirmDialog from '../../_components/ui/ConfirmDialog';
import CopyableValue from '../../_components/ui/CopyableValue';
import Menu, { MenuButton, MenuLink } from '../../_components/ui/Menu';
import StatusBadge from '../../_components/ui/StatusBadge';
import { useAdminToast } from '../../_components/ui/Toaster';
import BulkTrackingModal, { type PendingTrackingOrder } from '../../_components/ui/BulkTrackingModal';
import DataTable, { type DataColumn, type DataRowGroup } from '../../_components/data/DataTable';
import { BulkBar, RowSelectionProvider } from '../../_components/data/RowSelection';
import { EmptyState } from '../../_components/ui/States';
import AdminOrdersPoller from './AdminOrdersPoller';
import BulkDocumentsDialog from './BulkDocumentsDialog';
import type { OrderDocumentsDefaults } from '../../orders/[id]/OrderDocumentsCard';
import type { OrderPreparationMode } from '@/lib/orders/preparation/preparationPolicy';
import PreparationStepBadge from '../../_components/ui/PreparationStepBadge';
import { CLOSURE_REASON_LABELS, type ClosureReason } from '@/lib/orders/closure/closureRules';

interface ShippingAddress { city?: string; postal_code?: string; country?: string; line1?: string }
interface ShippingDetails { carrierName?: string; serviceName?: string; numParcels?: number; totalWeightG?: number }
export interface OrderItemRow { id: string; name: string; quantity: number; subtotal: number; storage_type: string | null; warehouse_location?: string | null; cold_chain_checked_at?: string | null }
export interface ListOrder {
  id: string; created_at: string; updated_at: string; full_name: string | null; email: string | null;
  fulfillment_type: 'delivery' | 'pickup'; shipping_address: ShippingAddress | null; shipping_details: ShippingDetails | null;
  subtotal: number; shipping_cost: number; total: number; payment_method: string | null; payment_status: string; status: OrderStatus;
  tracking_code: string | null; tracking_carrier: string | null; shipping_tracking_url: string | null;
  shipping_tracking_mode: 'managed' | 'manual' | null; shipping_provider_key: string | null; shipping_provider_reference: string | null;
  shipping_creation_status?: string | null; shipping_creation_updated_at?: string | null;
  shipping_normalized_status: NormalizedShipmentStatus | null; shipping_provider_synced_at: string | null; shipping_sync_error: string | null;
  shipping_tracking_events: ShipmentTrackingEvent[] | null; shipping_estimated_delivery_at: string | null; shipped_at?: string | null;
  picking_started_at: string | null; picking_completed_at: string | null; packing_completed_at: string | null; packing_parcel_count: number | null;
  cold_chain_packing_checked_at?: string | null;
  // Migration 160 (preparationPolicy): mode snapshot and paper flow.
  preparation_mode?: OrderPreparationMode | null; picking_list_printed_at?: string | null;
  paper_preparation_started_at?: string | null; paper_preparation_completed_at?: string | null; cold_chain_packing_declared_at?: string | null;
  closure_type?: string | null; closure_reason?: string | null;
  order_items: OrderItemRow[];
}
interface DetailData { suggestion: CartonSuggestion | null; missingWeightLines: number }
interface Props {
  orders: ListOrder[]; tenantCurrency: string;
  /** Tenant's current preparation mode: step of the orders not started yet. */
  tenantPreparationMode: OrderPreparationMode; carriers: string[]; thresholds: OperationalThresholds;
  canManage: boolean; managedProviderAvailable: boolean; nowIso: string; originCountry: string; sort: OrderSortKey;
  documentDefaults: OrderDocumentsDefaults;
  /** Link that clears every filter (empty state). */
  resetHref: string;
  hasFilters: boolean;
  /** View and targeting of the list: decides which groups start collapsed (`defaultGroupCollapsed`). */
  groupContext: QueueGroupContext;
  /** Size of each priority group in the whole filtered list (header counts). */
  groupCounts: Partial<Record<PriorityGroup, number>>;
}

const GROUP_ICON: Record<PriorityGroup, TablerIcon> = {
  action_required: IconAlertOctagon,
  preparation_overdue: IconClockExclamation,
  pickup_overdue: IconClockHour4,
  preparing: IconClipboardList,
  to_ship: IconPackage,
  shipping: IconTruckDelivery,
  pickup_ready: IconBuildingStore,
  finished: IconCircleCheck,
};

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
function customerTrackingHref(orderId: string) { return `/api/admin/orders/${orderId}/customer-tracking`; }
function carrierOf(order: ListOrder) { return carrierDisplayName(order.tracking_carrier ?? order.shipping_details?.carrierName); }
function unitCount(order: ListOrder) { return order.order_items.reduce((sum, item) => sum + item.quantity, 0); }
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

function rowToneOf(operation: OrderOperation): AdminTone | undefined {
  if (operation.group === 'action_required') return 'danger';
  if (operation.group === 'preparation_overdue' || operation.group === 'pickup_overdue') return 'urgent';
  if (operation.handling.score === 3) return 'warning';
  return undefined;
}

// Fresh / frozen are already counted next to the units (« 7 frais », « 9 surgelés »): no second badge.
function HandlingBadges({ operation }: { operation: OrderOperation }) {
  const { international, score } = operation.handling;
  if (!international && score !== 3) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1" aria-label="Attention logistique">
      {score === 3 && <Badge tone="danger">Priorité élevée</Badge>}
      {international && <Badge tone="info">International</Badge>}
    </span>
  );
}

/** New / preparing orders show their preparation step only (more precise than « En préparation »); other statuses their status. */
function OrderStateBadge({ order, operation }: { order: ListOrder; operation: OrderOperation }) {
  if (operation.step) return <PreparationStepBadge step={operation.step} />;
  return <StatusBadge status={order.status} fulfillmentType={order.fulfillment_type} closureType={order.closure_type} />;
}

/** Anomaly first, in its own colour: never mistaken for a regular state. */
function AnomalyLine({ operation }: { operation: OrderOperation }) {
  if (!operation.anomaly) return null;
  const danger = operation.flags.has('incidents') || operation.anomaly.code === 'stock_conflict';
  return (
    <p className={cn('flex items-start gap-1 text-sm font-semibold', danger ? 'text-tone-danger-fg' : 'text-tone-urgent-fg')}>
      <IconAlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{operation.anomaly.label}
    </p>
  );
}

function csvOf(rows: ListOrder[]) {
  const cell = (value: unknown) => `"${String(value ?? '').replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"`;
  const lines = [['Commande', 'Date', 'Client', 'E-mail', 'Total', 'Statut', 'Paiement', 'Transporteur'].map(cell).join(';'),
    ...rows.map(order => [shortId(order.id), formatDate(order.created_at, 'datetime'), order.full_name, order.email, Number(order.total ?? 0).toFixed(2).replace('.', ','), order.status, order.payment_method, carrierOf(order)].map(cell).join(';'))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

export default function OrdersTable({ orders, tenantPreparationMode, tenantCurrency, carriers, thresholds, canManage, managedProviderAvailable, nowIso, originCountry, sort, documentDefaults, resetHref, hasFilters, groupContext, groupCounts }: Props) {
  const router = useRouter();
  const toast = useAdminToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Open/closed choices of the user, per group. They survive polling refreshes
  // (router.refresh keeps client state) and reset only when the view or the
  // targeting changes, i.e. when the defaults themselves change.
  const contextKey = queueGroupContextKey(groupContext);
  const [groupChoices, setGroupChoices] = useState<{ key: string; collapsed: Partial<Record<PriorityGroup, boolean>> }>({ key: contextKey, collapsed: {} });
  const choices = groupChoices.key === contextKey ? groupChoices.collapsed : {};
  const isCollapsed = useCallback((group: PriorityGroup) => choices[group] ?? defaultGroupCollapsed(group, groupContext), [choices, groupContext]);
  const toggleGroup = (group: PriorityGroup) => setGroupChoices(previous => {
    const current = previous.key === contextKey ? previous.collapsed : {};
    return { key: contextKey, collapsed: { ...current, [group]: !(current[group] ?? defaultGroupCollapsed(group, groupContext)) } };
  });
  const [detail, setDetail] = useState<Record<string, DetailData>>({});
  const [detailError, setDetailError] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [documentIds, setDocumentIds] = useState<string[] | null>(null);
  const [bulkIds, setBulkIds] = useState<string[] | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [pendingTracking, setPendingTracking] = useState<PendingTrackingOrder[] | null>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const money = (value: number | null | undefined) => formatMoney(Number(value ?? 0), tenantCurrency || 'EUR');
  const operations = useMemo(() => new Map(orders.map(order => [order.id, classifyOrderOperation({ ...order, originCountry, managedProviderAvailable, tenantPreparationMode }, thresholds, now)])), [orders, originCountry, managedProviderAvailable, tenantPreparationMode, thresholds, now]);
  const grouped = sort === 'priority';
  // Rows of a collapsed group are off screen: they leave the selection (bulk actions never touch hidden orders).
  const rowIds = useMemo(() => orders.filter(order => !grouped || !isCollapsed(operations.get(order.id)!.group)).map(order => order.id), [orders, grouped, isCollapsed, operations]);
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

  /** Destination first (where the parcel goes), then carrier, parcels, weight, then copyable references. */
  function fulfillmentCell(order: ListOrder, compact = false) {
    if (order.fulfillment_type === 'pickup') return <p className="inline-flex items-center gap-1.5 font-semibold"><IconBuildingStore size={16} aria-hidden="true" /> Retrait magasin</p>;
    const meta = [carrierOf(order), parcelCount(order) != null && `${parcelCount(order)} colis`, weightLabel(order)].filter(Boolean).join(' · ');
    return (
      <div className={cn('space-y-0.5', !compact && 'max-w-[250px]')}>
        <p className="flex min-w-0 items-center gap-1.5"><IconTruck size={16} aria-hidden="true" className="shrink-0 text-a-text-2" /><b className="shrink-0 font-semibold">Livraison</b><span className="truncate font-medium">· {compactAddress(order) || 'Destination indisponible'}</span></p>
        {meta && <p className="truncate text-xs text-a-text-3">{meta}</p>}
        {!compact && order.shipping_provider_reference && <CopyableValue label="Réf." value={order.shipping_provider_reference} />}
        {!compact && order.tracking_code && order.tracking_code !== order.shipping_provider_reference && <CopyableValue label="Suivi" value={order.tracking_code} />}
      </div>
    );
  }

  /**
   * State block, ordered by the situation: anomaly first; for a shipped order
   * the carrier state leads (it is what moves), otherwise the order state. A
   * « Transport : Non associée » on an order not started yet says nothing: hidden.
   */
  function stateBlock(order: ListOrder, operation: OrderOperation) {
    const transport = transportState(order);
    const notStarted = (order.status === 'new' || order.status === 'stock_conflict') && !order.shipping_provider_reference && !order.shipping_sync_error && !order.tracking_code;
    // A carrier incident is already the anomaly line (« Incident transporteur », « Synchronisation… »): no second « Transport : Incident ».
    const transportBadge = transport && !done(order) && !notStarted && !operation.flags.has('incidents') ? <Badge tone={transport.tone}>Transport : {transport.label}</Badge> : null;
    const lastMove = lastTrackingEventAt(order);
    const eta = order.status === 'shipped' ? formatEta(order.shipping_estimated_delivery_at) : null;
    const shipped = order.status === 'shipped';
    return (
      <div className="flex min-w-0 flex-col items-start gap-1">
        <AnomalyLine operation={operation} />
        {shipped && transportBadge}
        {/* « Conflit de stock » is both the status and the anomaly: said once, by the anomaly line. */}
        {operation.anomaly?.code !== 'stock_conflict' && <OrderStateBadge order={order} operation={operation} />}
        {!shipped && transportBadge}
        {order.closure_reason && <p className="text-xs text-a-text-3">{CLOSURE_REASON_LABELS[order.closure_reason as ClosureReason] ?? ''}</p>}
        {lastMove && shipped && <p className="text-xs text-a-text-3">Mouvement {formatSince(lastMove, now)}</p>}
        {eta && <p className="text-xs text-a-text-3">Livraison estimée : {eta}</p>}
        {operation.notice && <p className="flex items-start gap-1 text-xs font-semibold text-tone-warning-fg"><IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{operation.notice}</p>}
      </div>
    );
  }

  /** Next action from the classifier; its weight comes from `orderActionEmphasis` (solid only when urgent). */
  function actionLink(order: ListOrder, operation: OrderOperation, full = false) {
    const { action } = operation;
    const label = canManage || action.intent === 'tracking' ? action.label : 'Voir la commande';
    // « Voir le suivi » opens what the customer sees (signed /orders/[id] page, built server-side).
    const trackingUrl = action.intent === 'tracking' ? customerTrackingHref(order.id) : null;
    const variant = orderActionEmphasis(operation, canManage);
    // The label may wrap on two lines in the table: a long action must never widen the row into a horizontal scroll.
    const className = buttonClasses({ variant, size: 'sm', className: full ? 'w-full min-h-10' : 'w-[9.5rem] !whitespace-normal py-1 text-center leading-tight' });
    if (trackingUrl) return <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className={className}>{label}<IconExternalLink size={14} aria-hidden="true" /><span className="sr-only"> (suivi client, nouvel onglet) : commande {shortId(order.id)}</span></a>;
    return <Link href={`/admin/orders/${order.id}`} className={className}>{label}<span className="sr-only"> : commande {shortId(order.id)}</span></Link>;
  }

  /** Accessory actions of a row (discreet level): same links as the detail panel, one click away. */
  function rowMenu(order: ListOrder) {
    const carrierUrl = carrierTrackingLink({ carrier: carrierOf(order), trackingCode: order.tracking_code, providerUrl: order.shipping_tracking_url });
    const open = expanded.has(order.id);
    return (
      <Menu label={`Autres actions : commande ${shortId(order.id)}`} trigger={<IconDotsVertical size={18} aria-hidden="true" />}
        triggerClassName="inline-flex h-10 w-10 md:h-9 md:w-9 items-center justify-center rounded-lg border border-a-border bg-a-surface text-a-text-2 hover:border-a-border-strong hover:text-a-text">
        <MenuLink href={`/admin/orders/${order.id}`}><IconEye size={16} aria-hidden="true" />Voir la commande</MenuLink>
        <MenuButton onSelect={() => toggleDetail(order)}>
          <IconChevronDown size={16} aria-hidden="true" className={open ? 'rotate-180' : undefined} />{open ? 'Masquer le détail' : 'Afficher le détail'}
        </MenuButton>
        {order.status !== 'cancelled' && <MenuLink newTab href={`/api/admin/orders/${order.id}/documents/picking-list`}><IconPrinter size={16} aria-hidden="true" />Liste de préparation (PDF)</MenuLink>}
        {order.status !== 'cancelled' && order.fulfillment_type === 'delivery' && documentDefaults.packingSlipEnabled && <MenuLink newTab href={`/api/admin/orders/${order.id}/documents/packing-slip`}><IconFileTypePdf size={16} aria-hidden="true" />Bon de colis (PDF)</MenuLink>}
        {order.fulfillment_type === 'delivery' && (order.tracking_code || order.shipping_provider_reference) && <MenuLink newTab href={customerTrackingHref(order.id)}><IconExternalLink size={16} aria-hidden="true" />Suivi client</MenuLink>}
        {carrierUrl && <MenuLink newTab href={carrierUrl}><IconTruckDelivery size={16} aria-hidden="true" />Suivi transporteur</MenuLink>}
      </Menu>
    );
  }

  function detailPanel(order: ListOrder, operation: OrderOperation) {
    const loaded = detail[order.id];
    const trackingUrl = carrierTrackingLink({ carrier: carrierOf(order), trackingCode: order.tracking_code, providerUrl: order.shipping_tracking_url });
    const lastMove = lastTrackingEventAt(order);
    const eta = formatEta(order.shipping_estimated_delivery_at);
    const heading = 'mb-2 text-xs font-semibold text-a-text-2';
    return (
      <div id={`order-detail-${order.id}`} role="region" aria-label={`Détail de la commande ${shortId(order.id)}`} className="grid gap-4 p-4 text-sm text-a-text md:grid-cols-3">
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

  function coldTags(order: ListOrder) {
    const cold = coldSummary(order);
    return <>
      {cold.fresh > 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-tone-success-bg px-1.5 text-xs font-semibold text-tone-success-fg"><IconLeaf size={13} aria-hidden="true" />{cold.fresh} frais</span>}
      {cold.frozen > 0 && <span className="inline-flex items-center gap-0.5 rounded-full bg-tone-info-bg px-1.5 text-xs font-semibold text-tone-info-fg"><IconSnowflake size={13} aria-hidden="true" />{cold.frozen} surgelé{cold.frozen > 1 ? 's' : ''}</span>}
    </>;
  }

  function preparationSummary(order: ListOrder, compact = false) {
    const count = unitCount(order);
    const extra = order.order_items.length - 2;
    return <>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5"><b className="font-semibold">{count} unité{count !== 1 ? 's' : ''}</b>
        {coldTags(order)}
      </p>
      {order.order_items.slice(0, 2).map(item => <p key={item.id} className={cn('text-xs text-a-text-2', compact ? 'line-clamp-1 break-words' : 'truncate')}>×{item.quantity} {item.name}</p>)}
      {extra > 0 && <p className="text-xs text-a-text-3">+{extra} autre{extra > 1 ? 's' : ''} produit{extra > 1 ? 's' : ''}</p>}
    </>;
  }

  const columns: DataColumn<ListOrder>[] = [
    {
      key: 'order', header: 'Commande', className: 'min-w-[190px]',
      cell: (order) => {
        const operation = operationOf(order);
        const open = expanded.has(order.id);
        return <>
          {/* Visible toggle (the whole row also toggles on click, see onRowClick). */}
          <div className="flex items-start gap-2">
            <button type="button" onClick={() => toggleDetail(order)} aria-expanded={open} aria-controls={`order-detail-${order.id}`}
              title={open ? 'Masquer le détail' : 'Afficher le détail'}
              className={cn('mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
                open ? 'border-a-brand bg-a-brand-soft text-a-brand-fg' : 'border-a-border-strong bg-a-surface text-a-text-2 group-hover/row:border-a-brand group-hover/row:text-a-brand-fg')}>
              <IconChevronDown size={16} aria-hidden="true" className={cn('transition-transform', !open && '-rotate-90')} />
              <span className="sr-only">{open ? 'Masquer' : 'Afficher'} le détail de {shortId(order.id)}</span>
            </button>
            <span className="min-w-0">
              <span className="block font-mono text-xs font-semibold text-a-text-3">{shortId(order.id)}</span>
              <span className="block max-w-[210px] truncate text-[15px] font-semibold leading-5">{order.full_name ?? order.email ?? 'Client'}</span>
              <span className="block text-xs text-a-text-3"><time dateTime={order.created_at}>{formatDate(order.created_at, 'datetime')}</time></span>
            </span>
          </div>
          {operation.urgency && <p className="mt-1.5 flex items-start gap-1 pl-10 text-xs font-semibold text-tone-urgent-fg"><IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{operation.urgency}</p>}
          {/* Tablet: « À préparer » and « Livraison / Retrait » are hidden; the essentials stay here, the rest in the detail. */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-10 text-xs text-a-text-2 lg:hidden">
            <b className="font-semibold text-a-text">{unitCount(order)} unité{unitCount(order) !== 1 ? 's' : ''}</b>{coldTags(order)}
            <span>· {order.fulfillment_type === 'pickup' ? 'Retrait magasin' : compactAddress(order) || 'Livraison'}</span>
          </p>
        </>;
      },
    },
    { key: 'items', header: 'À préparer', hideBelow: 'lg', className: 'max-w-[220px]', cell: (order) => <>{preparationSummary(order)}<HandlingBadges operation={operationOf(order)} /></> },
    { key: 'fulfillment', header: 'Livraison / Retrait', hideBelow: 'lg', cell: (order) => fulfillmentCell(order) },
    {
      key: 'state', header: 'État / Action',
      cell: (order) => {
        const operation = operationOf(order);
        // Side by side when the row is wide enough, the action under the state otherwise (never a horizontal scroll).
        return (
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            {stateBlock(order, operation)}
            <div className="shrink-0">{actionLink(order, operation)}</div>
          </div>
        );
      },
    },
    { key: 'total', header: 'Total', align: 'right', cell: (order) => <span className="font-semibold text-a-text">{money(order.total)}</span> },
    { key: 'menu', header: <span className="sr-only">Autres actions</span>, align: 'right', className: 'w-12 !pl-0', cell: rowMenu },
  ];

  const groups: DataRowGroup<ListOrder>[] | undefined = grouped
    ? orders.reduce<DataRowGroup<ListOrder>[]>((runs, order) => {
      const group = operationOf(order).group;
      const last = runs[runs.length - 1];
      if (last && last.id.startsWith(`${group}:`)) last.rows.push(order);
      else runs.push({ id: `${group}:${runs.length}`, label: PRIORITY_GROUP_LABELS[group], tone: PRIORITY_GROUP_TONE[group], icon: GROUP_ICON[group], rows: [order] });
      return runs;
    }, []).map((run) => {
      const group = run.id.split(':')[0] as PriorityGroup;
      const { count, pageNote } = groupCountLabel(run.rows.length, groupCounts[group]);
      return { ...run, total: count, note: pageNote, collapsed: isCollapsed(group), onToggle: () => toggleGroup(group) };
    })
    : undefined;

  function mobileCard(order: ListOrder) {
    const operation = operationOf(order);
    const open = expanded.has(order.id);
    return (
      <div className={cn('p-3 pl-4 text-sm', done(order) && 'text-a-text-2')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-a-text-3"><span className="font-mono font-semibold">{shortId(order.id)}</span> · <time dateTime={order.created_at}>{formatDate(order.created_at, 'datetime')}</time></p>
            <p className="line-clamp-2 break-words text-[15px] font-semibold leading-5 text-a-text">{order.full_name ?? order.email ?? 'Client'}</p>
          </div>
          <b className="shrink-0 font-semibold tabular-nums text-a-text">{money(order.total)}</b>
        </div>
        {operation.urgency && <p className="mt-1.5 flex items-start gap-1 text-xs font-semibold text-tone-urgent-fg"><IconAlertTriangle size={14} aria-hidden="true" className="mt-px shrink-0" />{operation.urgency}</p>}
        <div className="mt-2">{stateBlock(order, operation)}</div>
        <div className="mt-2 space-y-1 border-t border-a-border pt-2">
          {preparationSummary(order, true)}<HandlingBadges operation={operation} />
          {fulfillmentCell(order, true)}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">{actionLink(order, operation, true)}</div>
          <Button variant="secondary" size="sm" className="min-h-10" onClick={() => toggleDetail(order)} aria-expanded={open} aria-controls={`order-detail-${order.id}`} aria-label={`${open ? 'Masquer' : 'Afficher'} le détail de ${shortId(order.id)}`}>
            <IconChevronDown size={16} aria-hidden="true" className={open ? 'rotate-180' : undefined} />
          </Button>
          {rowMenu(order)}
        </div>
        {open && <div className="-mx-3 -mb-3 mt-3 border-t border-a-border bg-a-surface-2">{detailPanel(order, operation)}</div>}
      </div>
    );
  }

  return (
    <RowSelectionProvider rowIds={rowIds}>
      <AdminOrdersPoller onNewOrders={onNewOrders} isEditing={pendingTracking !== null || expanded.size > 0 || bulkIds !== null} />
      <DataTable<ListOrder>
        variant="queue"
        caption={`Commandes, triées par ${sort === 'priority' ? 'priorité opérationnelle' : sort === 'newest' ? 'date décroissante' : sort === 'oldest' ? 'date croissante' : 'montant'}`}
        columns={columns}
        rowKey={(order) => order.id}
        rows={orders}
        groups={groups}
        rowTone={(order) => rowToneOf(operationOf(order))}
        rowClassName={(order) => (done(order) ? 'text-a-text-2' : undefined)}
        selectable={{ label: (order) => `Sélectionner ${shortId(order.id)}` }}
        rowDetail={(order) => (expanded.has(order.id) ? detailPanel(order, operationOf(order)) : null)}
        onRowClick={toggleDetail}
        mobileCard={mobileCard}
        empty={hasFilters
          ? <EmptyState variant="filtered" title="Aucune commande ne correspond à ces filtres." description="Modifiez la recherche ou les filtres pour élargir la liste." action={<Link href={resetHref} className={buttonClasses({ variant: 'secondary' })}>Effacer les filtres</Link>} />
          : <EmptyState title="Aucune commande pour le moment." description="Les nouvelles commandes de la boutique apparaîtront ici." />}
      />
      <BulkBar rowIds={rowIds}>
        {(ids) => <>
          <Link href={`/admin/orders/preparation?ids=${ids.join(',')}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}><IconClipboardList size={16} aria-hidden="true" />Préparer la sélection</Link>
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
