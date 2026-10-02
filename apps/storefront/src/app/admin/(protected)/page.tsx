import Link from 'next/link'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac'
import { dailyDigestModule, DAILY_DIGEST_DEFAULTS } from '@/lib/notifications/dailyDigestConfig'
import { readModuleConfig } from '@/lib/tenantConfig/moduleConfig'
import type { OperationalThresholds } from '@/lib/orders/adminOrderOperations'
import { managedShippingProviderInfo } from '@/lib/shipping/providers/registry'
import {
  IconChevronLeft,
  IconChevronRight,
  IconClipboardList,
  IconPlus,
  IconSearch,
  IconX,
} from '@tabler/icons-react'
import AdminFilters from './AdminFilters'
import OrdersTable from './OrdersTable'
import PendingPaymentsBanner from './PendingPaymentsBanner'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import type { ListOrder } from './OrdersTable'
import type { PendingPaymentSession } from './PendingPaymentsBanner'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const PAGE_SIZE = 50
const AGED_MS = 24 * 60 * 60 * 1000
const INCIDENT_FILTER = 'shipping_normalized_status.in.(exception,returned,cancelled),shipping_sync_error.not.is.null'

type OrderView = '' | 'to_treat' | 'preparing' | 'to_ship' | 'in_transit' | 'incidents' | 'pickup_ready' | 'urgent' | 'finished' | 'payment_pending' | 'aged' | 'picking_incomplete' | 'packing_pending' | 'tracking_missing'
type SortKey = 'date_desc' | 'date_asc' | 'total_desc' | 'total_asc'

interface PageProps {
  searchParams: {
    status?: string
    dateFrom?: string
    dateTo?: string
    fulfillment?: string
    payment?: string
    q?: string
    page?: string
    view?: string
    sort?: string
  }
}

const STATUS_TABS = [
  { key: '', label: 'Toutes' },
  { key: 'new', label: 'Nouvelles' },
  { key: 'preparing', label: 'À préparer' },
  { key: 'ready_for_pickup', label: 'Prêtes au retrait' },
  { key: 'shipped', label: 'Expédiées' },
  { key: 'delivered', label: 'Livrées' },
  { key: 'cancelled', label: 'Annulées' },
  { key: 'stock_conflict', label: 'Conflit stock' },
] as const

const VALID_VIEWS = new Set<OrderView>(['', 'to_treat', 'preparing', 'to_ship', 'in_transit', 'incidents', 'pickup_ready', 'urgent', 'finished', 'payment_pending', 'aged', 'picking_incomplete', 'packing_pending', 'tracking_missing'])
const VALID_SORTS = new Set<SortKey>(['date_desc', 'date_asc', 'total_desc', 'total_asc'])

function sanitizeSearch(raw: string) {
  return raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60)
}

function sanitizeView(raw: string | undefined): OrderView {
  const value = (raw ?? '') as OrderView
  return VALID_VIEWS.has(value) ? value : ''
}

function sanitizeSort(raw: string | undefined): SortKey {
  const value = (raw ?? 'date_desc') as SortKey
  return VALID_SORTS.has(value) ? value : 'date_desc'
}

function appendSharedParams(params: URLSearchParams, searchParams: PageProps['searchParams']) {
  if (searchParams.dateFrom) params.set('dateFrom', searchParams.dateFrom)
  if (searchParams.dateTo) params.set('dateTo', searchParams.dateTo)
  if (searchParams.fulfillment) params.set('fulfillment', searchParams.fulfillment)
  if (searchParams.payment) params.set('payment', searchParams.payment)
  if (searchParams.q) params.set('q', sanitizeSearch(searchParams.q))
  const view = sanitizeView(searchParams.view)
  const sort = sanitizeSort(searchParams.sort)
  if (view) params.set('view', view)
  if (sort !== 'date_desc') params.set('sort', sort)
}

function buildStatusHref(searchParams: PageProps['searchParams'], status: string) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (searchParams.dateFrom) params.set('dateFrom', searchParams.dateFrom)
  if (searchParams.dateTo) params.set('dateTo', searchParams.dateTo)
  if (searchParams.payment) params.set('payment', searchParams.payment)
  if (searchParams.q) params.set('q', sanitizeSearch(searchParams.q))
  const sort = sanitizeSort(searchParams.sort)
  if (sort !== 'date_desc') params.set('sort', sort)
  const query = params.toString()
  return query ? `/admin?${query}` : '/admin'
}

function buildPageHref(searchParams: PageProps['searchParams'], page: number) {
  const params = new URLSearchParams()
  if (searchParams.status) params.set('status', searchParams.status)
  appendSharedParams(params, searchParams)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/admin?${query}` : '/admin'
}

function buildViewHref(searchParams: PageProps['searchParams'], view: OrderView) {
  const params = new URLSearchParams()
  if (view) params.set('view', view)
  if (searchParams.dateFrom) params.set('dateFrom', searchParams.dateFrom)
  if (searchParams.dateTo) params.set('dateTo', searchParams.dateTo)
  if (searchParams.q) params.set('q', sanitizeSearch(searchParams.q))
  const sort = sanitizeSort(searchParams.sort)
  if (sort !== 'date_desc') params.set('sort', sort)
  const query = params.toString()
  return query ? `/admin?${query}` : '/admin'
}

function buildSortHref(searchParams: PageProps['searchParams'], sort: SortKey) {
  const params = new URLSearchParams()
  if (searchParams.status) params.set('status', searchParams.status)
  appendSharedParams(params, { ...searchParams, sort: undefined })
  if (sort !== 'date_desc') params.set('sort', sort)
  const query = params.toString()
  return query ? `/admin?${query}` : '/admin'
}

export default async function AdminPage({ searchParams }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'
  const tenant = await getTenant(tenantSlug)
  const supabase = createServiceClient()
  const [access, digest] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    readModuleConfig(supabase, dailyDigestModule, tenant.id).catch(() => null),
  ])
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))
  const digestConfig = digest?.status === 'ok' ? digest.config : DAILY_DIGEST_DEFAULTS
  const thresholds: OperationalThresholds = {
    prepareHours: digestConfig.prepare_hours,
    pickupHours: digestConfig.pickup_hours,
    trackingStaleHours: digestConfig.tracking_stale_hours,
  }

  const filterStatus = STATUS_TABS.some(tab => tab.key === searchParams.status) ? searchParams.status! : ''
  const filterDateFrom = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dateFrom ?? '') ? searchParams.dateFrom! : ''
  const filterDateTo = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dateTo ?? '') ? searchParams.dateTo! : ''
  const filterFulfillment = ['delivery', 'pickup'].includes(searchParams.fulfillment ?? '') ? searchParams.fulfillment! : ''
  const filterPayment = ['stripe', 'external_link', 'satispay', 'in_store', 'cash', 'manual'].includes(searchParams.payment ?? '') ? searchParams.payment! : ''
  const searchQuery = sanitizeSearch(searchParams.q ?? '')
  const filterView = sanitizeView(searchParams.view)
  const sortKey = sanitizeSort(searchParams.sort)
  const requestedPage = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const agedCutoffIso = new Date(Date.now() - AGED_MS).toISOString()
  const prepareCutoffIso = new Date(Date.now() - thresholds.prepareHours * 3_600_000).toISOString()
  const pickupCutoffIso = new Date(Date.now() - thresholds.pickupHours * 3_600_000).toISOString()
  const nowIso = new Date().toISOString()

  // Les compteurs historiques viennent de la vue agrégée 118. Les nouveaux
  // groupes qui dépendent des snapshots shipping utilisent des count(head)
  // tenant-scoped ; aucune ligne d'ordre n'est téléchargée pour ces badges.
  const [{ data: stats, error: statsError }, { data: carriersRaw }, { data: pendingPaymentsRaw }, { count: activePreordersCount },
    toTreatResult, readyToShipResult, transitResult, incidentResult, stockConflictResult] = await Promise.all([
    supabase
      .from('admin_order_dashboard_stats')
      .select('*')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    supabase
      .from('carriers')
      .select('name')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .order('position', { ascending: true }),
    supabase
      .from('checkout_sessions')
      .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, external_payment_type, external_payment_label, created_at')
      .eq('tenant_id', tenant.id)
      .eq('payment_method', 'external_link')
      .in('status', ['open', 'expired', 'awaiting_verification'])
      .is('order_id', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('checkout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('origin', 'assisted')
      .in('status', ['draft', 'open', 'awaiting_verification']),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .not('status', 'in', '(delivered,cancelled)')
      .or(`status.in.(new,preparing,ready_for_pickup,stock_conflict),${INCIDENT_FILTER}`),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .eq('status', 'preparing').eq('fulfillment_type', 'delivery')
      .not('picking_completed_at', 'is', null).not('packing_completed_at', 'is', null),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .eq('status', 'shipped').eq('fulfillment_type', 'delivery')
      .in('shipping_normalized_status', ['in_transit', 'out_for_delivery']),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .eq('fulfillment_type', 'delivery').in('status', ['new', 'preparing', 'shipped']).or(INCIDENT_FILTER),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('status', 'stock_conflict'),
  ])
  const carriers = ((carriersRaw ?? []) as { name: string }[]).map(carrier => carrier.name)
  const pendingPayments = (pendingPaymentsRaw ?? []) as PendingPaymentSession[]

  const totalCount = Number(stats?.total_count ?? 0)
  const newCount = Number(stats?.new_count ?? 0)
  const toPrepare = Number(stats?.preparing_count ?? 0)
  const readyForPickup = Number(stats?.ready_for_pickup_count ?? 0)
  const pendingPaymentCount = Number(stats?.pending_payment_count ?? 0)
  const pickingIncompleteCount = Number(stats?.picking_incomplete_count ?? 0)
  const packingPendingCount = Number(stats?.packing_pending_count ?? 0)
  const trackingMissingCount = Number(stats?.tracking_missing_count ?? 0)
  const coldChainActionCount = Number(stats?.cold_chain_action_count ?? 0)
  const toTreatCount = toTreatResult.count ?? 0
  const readyToShipCount = readyToShipResult.count ?? 0
  const transitCount = transitResult.count ?? 0
  const incidentCount = incidentResult.count ?? 0
  const countsUnavailable = Boolean(statsError || toTreatResult.error || readyToShipResult.error || transitResult.error || incidentResult.error)

  const statusCounts: Record<string, number> = {
    new: newCount,
    preparing: toPrepare,
    ready_for_pickup: readyForPickup,
    shipped: Number(stats?.shipped_count ?? 0),
    delivered: Number(stats?.delivered_count ?? 0),
    cancelled: Number(stats?.cancelled_count ?? 0),
    stock_conflict: stockConflictResult.count ?? 0,
  }

  let query = supabase
    .from('orders')
    .select(`
      id, created_at, updated_at, email, full_name, status, total,
      subtotal, shipping_cost, payment_method, payment_status,
      fulfillment_type, shipping_address, shipping_details,
      tracking_code, tracking_carrier, shipping_tracking_url, shipping_tracking_mode,
      shipping_provider_key, shipping_provider_reference, shipping_normalized_status,
      shipping_provider_synced_at, shipping_sync_error,
      shipping_estimated_delivery_at, picking_started_at, picking_completed_at,
      packing_completed_at, packing_parcel_count,
      order_items(id, name, quantity, subtotal, storage_type, warehouse_location)
    `, { count: 'exact' })
    .eq('tenant_id', tenant.id)

  if (filterView === 'to_treat') {
    query = query.not('status', 'in', '(delivered,cancelled)').or(`status.in.(new,preparing,ready_for_pickup,stock_conflict),${INCIDENT_FILTER}`)
  } else if (filterView === 'preparing') {
    query = query.eq('status', 'preparing')
  } else if (filterView === 'to_ship') {
    query = query.eq('status', 'preparing').eq('fulfillment_type', 'delivery')
      .not('picking_completed_at', 'is', null).not('packing_completed_at', 'is', null)
  } else if (filterView === 'in_transit') {
    query = query.eq('status', 'shipped').eq('fulfillment_type', 'delivery').in('shipping_normalized_status', ['in_transit', 'out_for_delivery'])
  } else if (filterView === 'incidents') {
    query = query.eq('fulfillment_type', 'delivery').in('status', ['new', 'preparing', 'shipped']).or(INCIDENT_FILTER)
  } else if (filterView === 'urgent') {
    query = query.or(`status.eq.stock_conflict,and(status.eq.new,created_at.lte.${prepareCutoffIso}),and(status.eq.preparing,picking_started_at.lte.${prepareCutoffIso}),and(status.eq.preparing,picking_started_at.is.null,created_at.lte.${prepareCutoffIso}),and(status.eq.ready_for_pickup,updated_at.lte.${pickupCutoffIso}),and(status.in.(new,preparing,ready_for_pickup,shipped),payment_status.neq.paid),and(status.in.(new,preparing,shipped),fulfillment_type.eq.delivery,or(${INCIDENT_FILTER})),and(status.eq.shipped,fulfillment_type.eq.delivery,shipping_provider_reference.not.is.null,shipping_estimated_delivery_at.lt.${nowIso},shipping_normalized_status.in.(in_transit,out_for_delivery,ready_for_collection))`)
  } else if (filterView === 'finished') {
    query = query.in('status', ['delivered', 'cancelled'])
  } else if (filterView === 'pickup_ready') {
    query = query.eq('status', 'ready_for_pickup').eq('fulfillment_type', 'pickup')
  } else if (filterView === 'payment_pending') {
    query = query.eq('payment_status', 'pending')
  } else if (filterView === 'aged') {
    query = query.lte('created_at', agedCutoffIso).not('status', 'in', '(delivered,cancelled)')
  } else if (filterView === 'picking_incomplete') {
    query = query.eq('status', 'preparing').is('picking_completed_at', null)
  } else if (filterView === 'packing_pending') {
    query = query.eq('status', 'preparing').eq('fulfillment_type', 'delivery')
      .not('picking_completed_at', 'is', null).is('packing_completed_at', null)
  } else if (filterView === 'tracking_missing') {
    query = query.eq('status', 'preparing').eq('fulfillment_type', 'delivery')
      .not('packing_completed_at', 'is', null).is('tracking_code', null)
  } else {
    if (filterStatus) query = query.eq('status', filterStatus)
  }
  if (filterFulfillment) query = query.eq('fulfillment_type', filterFulfillment)
  if (filterPayment) query = query.eq('payment_method', filterPayment)

  if (filterDateFrom) query = query.gte('created_at', new Date(filterDateFrom).toISOString())
  if (filterDateTo) {
    const end = new Date(filterDateTo)
    end.setHours(23, 59, 59, 999)
    query = query.lte('created_at', end.toISOString())
  }

  if (searchQuery) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (uuidPattern.test(searchQuery)) query = query.eq('id', searchQuery)
    else if (/^#?[0-9a-f]{8}$/i.test(searchQuery)) {
      const prefix = searchQuery.replace(/^#/, '').toLowerCase()
      query = query.gte('id', `${prefix}-0000-0000-0000-000000000000`).lte('id', `${prefix}-ffff-ffff-ffff-ffffffffffff`)
    }
    else {
      const escaped = searchQuery.replace(/[%_]/g, '')
      query = query.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`)
    }
  }

  if (sortKey === 'date_asc') query = query.order('created_at', { ascending: true }).order('id')
  else if (sortKey === 'total_desc') query = query.order('total', { ascending: false }).order('created_at', { ascending: false })
  else if (sortKey === 'total_asc') query = query.order('total', { ascending: true }).order('created_at', { ascending: false })
  else query = query.order('created_at', { ascending: false }).order('id')

  const initialFrom = (requestedPage - 1) * PAGE_SIZE
  const initialTo = initialFrom + PAGE_SIZE - 1
  const firstResult = await query.range(initialFrom, initialTo)
  const filteredCount = firstResult.count ?? 0
  let listError = firstResult.error
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)

  let orderList = (firstResult.data ?? []) as unknown as ListOrder[]
  if (!listError && currentPage !== requestedPage) {
    const from = (currentPage - 1) * PAGE_SIZE
    const corrected = await query.range(from, from + PAGE_SIZE - 1)
    orderList = (corrected.data ?? []) as unknown as ListOrder[]
    listError = corrected.error
  }
  // Les événements JSON ne sont lus qu'en un lot pour les lignes associées de
  // cette page, jamais pour l'historique entier ni par commande/provider.
  const trackedIds = orderList.filter(order => order.fulfillment_type === 'delivery' && order.shipping_provider_reference).map(order => order.id)
  if (!listError && trackedIds.length) {
    const { data: eventRows, error: eventsError } = await supabase.from('orders').select('id, shipping_tracking_events')
      .eq('tenant_id', tenant.id).in('id', trackedIds)
    if (!eventsError) {
      const eventsById = new Map((eventRows ?? []).map(row => [row.id, row.shipping_tracking_events]))
      orderList = orderList.map(order => ({ ...order, shipping_tracking_events: (eventsById.get(order.id) ?? null) as ListOrder['shipping_tracking_events'] }))
    }
  }

  const activeFilterCount = [filterDateFrom, filterDateTo, filterFulfillment, filterPayment, filterView].filter(Boolean).length
  const pageStart = filteredCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredCount)

  const operationalViews: { key: OrderView; label: string; count: number; helper: string; tone: string }[] = [
    { key: 'to_treat', label: 'À traiter', count: toTreatCount, helper: 'Action opérateur requise', tone: 'border-violet-200 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/20' },
    { key: 'preparing', label: 'En préparation', count: toPrepare, helper: 'Picking et packing', tone: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' },
    { key: 'to_ship', label: 'À expédier', count: readyToShipCount, helper: 'Préparation terminée', tone: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' },
    { key: 'in_transit', label: 'En transit', count: transitCount, helper: 'Confirmé par le transporteur', tone: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20' },
    { key: 'incidents', label: 'Incidents', count: incidentCount, helper: 'Statut ou synchro avéré', tone: 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20' },
    { key: 'pickup_ready', label: 'Retraits prêts', count: readyForPickup, helper: 'Client attendu', tone: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20' },
  ]

  const quickFilters = [
    { key: '', label: 'Tous' }, { key: 'delivery', label: 'Livraison' }, { key: 'pickup', label: 'Retrait' },
    { key: 'urgent', label: 'Urgents' }, { key: 'incidents', label: 'Incidents' }, { key: 'finished', label: 'Terminés' },
  ] as const

  return (
    <div className="mx-auto w-full max-w-7xl pb-8">
      <AdminPageHeader
        title="Commandes"
        description="Traitez d'abord les commandes qui demandent votre attention."
        meta={`${totalCount} commande${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/orders/precommandes" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              <IconClipboardList size={17} /> Précommandes
              {(activePreordersCount ?? 0) > 0 && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-bold text-amber-800">{activePreordersCount}</span>}
            </Link>
            {canManage && <Link href="/admin/orders/new" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--admin-primary)] px-4 text-sm font-semibold text-white hover:opacity-90">
              <IconPlus size={17} /> Nouvelle commande
            </Link>}
          </div>
        )}
      />

      {countsUnavailable && <p role="alert" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">Certains compteurs sont indisponibles. <Link href="/admin" className="underline">Réessayer</Link></p>}
      <section className="mb-4 rounded-2xl border border-[var(--admin-border)] bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">À faire maintenant</p>
            <h2 className="mt-1 text-base font-semibold text-gray-950 dark:text-gray-100">File de fulfillment</h2>
          </div>
          <p className="text-xs text-gray-400">Chaque carte ouvre directement les commandes concernées.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {operationalViews.map(view => {
            const active = filterView === view.key
            return (
              <Link key={view.key} href={buildViewHref(searchParams, active ? '' : view.key)} className={`min-h-[88px] rounded-xl border p-3 transition-colors ${active ? 'border-[#C9C1FF] bg-[var(--admin-primary-soft)] ring-1 ring-[#D9D3FF]' : view.tone || 'border-gray-200 bg-gray-50/70 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:bg-gray-950/50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{view.label}</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">{view.helper}</p>
                  </div>
                  <span className={`min-w-9 rounded-full px-2 py-1 text-center text-sm font-bold ${view.count > 0 ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-900 dark:text-gray-100' : 'bg-gray-100 text-gray-400 dark:bg-gray-800'}`}>{view.count}</span>
                </div>
              </Link>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">Contrôles : picking incomplet {pickingIncompleteCount} · packing à terminer {packingPendingCount} · tracking manquant {trackingMissingCount} · chaîne du froid {coldChainActionCount} · paiement à vérifier {pendingPaymentCount}</p>
      </section>

      {pendingPayments.length > 0 && <div className="mb-4"><PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} /></div>}

      <section className="mb-3 overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <nav className="flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] p-2 dark:border-gray-800" aria-label="Filtres rapides">
          {quickFilters.map(item => {
            const isFulfillment = item.key === 'delivery' || item.key === 'pickup'
            const active = isFulfillment ? !filterView && filterFulfillment === item.key : item.key ? filterView === item.key : !filterView && !filterFulfillment
            const href = isFulfillment
              ? `/admin?fulfillment=${item.key}`
              : item.key ? buildViewHref(searchParams, item.key as OrderView) : '/admin'
            return <Link key={item.key || 'all'} href={href} aria-current={active ? 'page' : undefined}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] ${active ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}>{item.label}</Link>
          })}
        </nav>

        <div className="flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] px-2 py-1.5 dark:border-gray-800 sm:px-3" aria-label="Statuts des commandes">
          {STATUS_TABS.map(tab => {
            const active = !filterView && filterStatus === tab.key
            const count = tab.key ? (statusCounts[tab.key] ?? 0) : totalCount
            return (
              <Link key={tab.key || 'all'} href={buildStatusHref(searchParams, tab.key)} className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${active ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]' : tab.key === 'preparing' && count > 0 ? 'text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40' : 'text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'}`}>
                {tab.label}<span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] ${active ? 'bg-white/80 dark:bg-gray-900/70' : tab.key === 'preparing' && count > 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-800'}`}>{count}</span>
              </Link>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
          <Suspense fallback={<div className="h-9" />}><AdminFilters currentStatus={filterStatus} currentDateFrom={filterDateFrom} currentDateTo={filterDateTo} currentFulfillment={filterFulfillment} currentPayment={filterPayment} statusCounts={statusCounts} hideStatus /></Suspense>
          {(filterStatus || activeFilterCount > 0 || searchQuery) && <Link href="/admin" className="shrink-0 text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">Réinitialiser{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</Link>}
        </div>
      </section>

      <div className="mb-3 flex flex-col gap-2 rounded-xl border border-[var(--admin-border)] bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 lg:flex-row lg:items-center lg:justify-between">
        <form method="get" action="/admin" className="flex min-w-0 flex-1 items-center gap-2">
          {filterStatus && !filterView && <input type="hidden" name="status" value={filterStatus} />}
          {filterView && <input type="hidden" name="view" value={filterView} />}
          {filterDateFrom && <input type="hidden" name="dateFrom" value={filterDateFrom} />}
          {filterDateTo && <input type="hidden" name="dateTo" value={filterDateTo} />}
          {filterFulfillment && <input type="hidden" name="fulfillment" value={filterFulfillment} />}
          {filterPayment && <input type="hidden" name="payment" value={filterPayment} />}
          {sortKey !== 'date_desc' && <input type="hidden" name="sort" value={sortKey} />}
          <div className="relative w-full max-w-xl"><IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="search" name="q" defaultValue={searchQuery} placeholder="Client, email ou UUID de commande..." className="h-10 w-full rounded-xl border border-[var(--admin-border)] bg-white pl-9 pr-9 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />{searchQuery && <Link href={buildPageHref({ ...searchParams, q: undefined, page: undefined }, 1)} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"><IconX size={14} /></Link>}</div>
          <button type="submit" className="h-10 shrink-0 rounded-xl bg-[var(--admin-primary)] px-3 text-sm font-semibold text-white hover:opacity-90">Rechercher</button>
        </form>

        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{filteredCount} résultat{filteredCount !== 1 ? 's' : ''}</p>
          <nav aria-label="Trier les commandes" className="flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
            {([['date_desc', 'Plus récentes'], ['date_asc', 'Plus anciennes'], ['total_desc', 'Montant ↓'], ['total_asc', 'Montant ↑']] as [SortKey, string][]).map(([key, label]) => <Link key={key} href={buildSortHref(searchParams, key)} aria-current={sortKey === key ? 'page' : undefined} className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${sortKey === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>{label}</Link>)}
          </nav>
        </div>
      </div>

      {listError
        ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">Impossible de charger les commandes. <Link href={buildPageHref(searchParams, 1)} className="font-bold underline">Réessayer</Link></div>
        : <OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} thresholds={thresholds} canManage={canManage} managedProviderAvailable={Boolean(managedShippingProviderInfo(tenant.shipping_provider))} nowIso={nowIso} />}

      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-3 py-2.5 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">{pageStart}–{pageEnd} sur {filteredCount} commande{filteredCount !== 1 ? 's' : ''}</span>
        <nav className="flex items-center gap-1" aria-label="Pagination des commandes">
          {currentPage > 1 ? <Link href={buildPageHref(searchParams, currentPage - 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 text-xs font-semibold text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-300"><IconChevronLeft size={14} /> Précédent</Link> : <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-100 px-2.5 text-xs font-semibold text-gray-300 dark:border-gray-800 dark:text-gray-600"><IconChevronLeft size={14} /> Précédent</span>}
          <span className="min-w-20 px-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-200">{currentPage} / {totalPages}</span>
          {currentPage < totalPages ? <Link href={buildPageHref(searchParams, currentPage + 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 text-xs font-semibold text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-300">Suivant <IconChevronRight size={14} /></Link> : <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-100 px-2.5 text-xs font-semibold text-gray-300 dark:border-gray-800 dark:text-gray-600">Suivant <IconChevronRight size={14} /></span>}
        </nav>
      </div>
    </div>
  )
}
