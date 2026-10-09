import Link from 'next/link'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac'
import { dailyDigestModule, DAILY_DIGEST_DEFAULTS } from '@/lib/notifications/dailyDigestConfig'
import { readModuleConfig } from '@/lib/tenantConfig/moduleConfig'
import { parseOrderSort, type OperationalThresholds, type QueueKey } from '@/lib/orders/adminOrderOperations'
import { loadOrderWorkQueue, ORDER_VIEWS, type OrderView, type WorkQueueResult } from '@/lib/orders/loadOrderWorkQueue'
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
import OrdersSortSelect from './OrdersSortSelect'
import PendingPaymentsBanner from './PendingPaymentsBanner'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import AdminStatCard from '../_components/ui/AdminStatCard'
import type { ListOrder } from './OrdersTable'
import { readOrderDocumentSettings } from '@/lib/orders/documents/settings'
import type { PendingPaymentSession } from './PendingPaymentsBanner'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const PAGE_SIZE = 50
const STATUSES = ['new', 'preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled', 'stock_conflict']

type SearchParams = {
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

function sanitizeSearch(raw: string) {
  return raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\-# ]/g, '').slice(0, 60)
}

function sanitizeView(raw: string | undefined): OrderView {
  return ORDER_VIEWS.includes((raw ?? '') as OrderView) ? (raw ?? '') as OrderView : ''
}

/** /admin URL keeping the current list state, with `patch` applied (undefined/'' removes a key). Page always resets. */
function buildHref(searchParams: SearchParams, patch: Partial<SearchParams>) {
  const params = new URLSearchParams()
  const merged: SearchParams = { ...searchParams, page: undefined, ...patch }
  for (const key of ['view', 'status', 'fulfillment', 'payment', 'dateFrom', 'dateTo', 'q', 'sort', 'page'] as const) {
    const value = merged[key]
    if (value) params.set(key, key === 'q' ? sanitizeSearch(value) : value)
  }
  const query = params.toString()
  return query ? `/admin?${query}` : '/admin'
}

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'
  const tenant = await getTenant(tenantSlug)
  const supabase = createServiceClient()
  const [access, digest, documentSettings] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    readModuleConfig(supabase, dailyDigestModule, tenant.id).catch(() => null),
    readOrderDocumentSettings(supabase, tenant.id),
  ])
  const documentDefaults = {
    pickingFormat: documentSettings.config.picking_list_format,
    packingSlipEnabled: documentSettings.config.packing_slip_enabled,
    packingSlipFormat: documentSettings.config.packing_slip_format,
    packingSlipQrUnavailable: !documentSettings.available && documentSettings.config.packing_slip_show_qr,
  }
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))
  // Same tenant-scoped thresholds as the daily digest; module defaults otherwise.
  const digestConfig = digest?.status === 'ok' ? digest.config : DAILY_DIGEST_DEFAULTS
  const thresholds: OperationalThresholds = {
    prepareHours: digestConfig.prepare_hours,
    pickupHours: digestConfig.pickup_hours,
    trackingStaleHours: digestConfig.tracking_stale_hours,
  }
  const managedProviderAvailable = Boolean(managedShippingProviderInfo(tenant.shipping_provider))

  const filterView = sanitizeView(searchParams.view)
  const filters = {
    view: filterView,
    status: STATUSES.includes(searchParams.status ?? '') ? searchParams.status! : '',
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dateFrom ?? '') ? searchParams.dateFrom! : '',
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(searchParams.dateTo ?? '') ? searchParams.dateTo! : '',
    fulfillment: ['delivery', 'pickup'].includes(searchParams.fulfillment ?? '') ? searchParams.fulfillment! : '',
    payment: ['stripe', 'external_link', 'satispay', 'in_store', 'cash', 'manual'].includes(searchParams.payment ?? '') ? searchParams.payment! : '',
    search: sanitizeSearch(searchParams.q ?? ''),
  }
  const sortKey = parseOrderSort(searchParams.sort)
  const requestedPage = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const now = new Date()

  const [{ data: stats, error: statsError }, { data: carriersRaw }, { data: pendingPaymentsRaw }, { count: activePreordersCount }, { count: preordersToVerifyCount }, queue] = await Promise.all([
    supabase.from('admin_order_dashboard_stats').select('*').eq('tenant_id', tenant.id).maybeSingle(),
    supabase.from('carriers').select('name').eq('tenant_id', tenant.id).eq('active', true).order('position', { ascending: true }),
    supabase
      .from('checkout_sessions')
      .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, external_payment_type, external_payment_label, created_at')
      .eq('tenant_id', tenant.id)
      .eq('payment_method', 'external_link')
      // Storefront checkouts only: assisted preorders are verified in Précommandes (own flow and notifications).
      .eq('origin', 'storefront')
      .in('status', ['open', 'expired', 'awaiting_verification'])
      .is('order_id', null)
      .order('created_at', { ascending: true }),
    supabase
      .from('checkout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('origin', 'assisted')
      .in('status', ['draft', 'open', 'awaiting_verification']),
    supabase
      .from('checkout_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('origin', 'assisted')
      .eq('status', 'awaiting_verification'),
    loadOrderWorkQueue(supabase, tenant.id, { filters, sort: sortKey, page: requestedPage, pageSize: PAGE_SIZE, thresholds, now, managedProviderAvailable, originCountry: tenant.country })
      .catch((error: unknown): WorkQueueResult | null => { console.error('[admin/orders] work queue unavailable', error); return null }),
  ])
  const carriers = ((carriersRaw ?? []) as { name: string }[]).map(carrier => carrier.name)
  const pendingPayments = (pendingPaymentsRaw ?? []) as PendingPaymentSession[]

  const totalCount = Number(stats?.total_count ?? 0)
  const kpi = (key: QueueKey) => queue?.kpis[key] ?? 0
  const countsUnavailable = Boolean(statsError || !queue)
  const statusCounts: Record<string, number> = {
    new: Number(stats?.new_count ?? 0),
    preparing: Number(stats?.preparing_count ?? 0),
    ready_for_pickup: Number(stats?.ready_for_pickup_count ?? 0),
    shipped: Number(stats?.shipped_count ?? 0),
    delivered: Number(stats?.delivered_count ?? 0),
    cancelled: Number(stats?.cancelled_count ?? 0),
    stock_conflict: queue?.activeStatusCounts.stock_conflict ?? 0,
  }

  const orderList = (queue?.rows ?? []) as unknown as ListOrder[]
  const filteredCount = queue?.total ?? 0
  const currentPage = queue?.currentPage ?? 1
  const totalPages = queue?.totalPages ?? 1
  const pageStart = filteredCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredCount)
  const activeFilterCount = [filters.dateFrom, filters.dateTo, filters.fulfillment, filters.payment, filters.status, filterView].filter(Boolean).length
  const pageHref = (page: number) => buildHref(searchParams, { page: page > 1 ? String(page) : undefined })

  const operationalViews: { key: OrderView; label: string; helper: string; tone: string }[] = [
    { key: 'to_treat', label: 'À traiter', helper: 'Une action de l’équipe est attendue', tone: 'border-violet-300 bg-violet-50/90 dark:border-violet-900 dark:bg-violet-950/20' },
    { key: 'preparing', label: 'En préparation', helper: 'Préparation et emballage', tone: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' },
    { key: 'to_ship', label: 'À expédier', helper: 'Colis prêts à partir', tone: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' },
    { key: 'in_transit', label: 'En transit', helper: 'Confirmé par le transporteur', tone: 'border-sky-200 bg-sky-50/70 dark:border-sky-900 dark:bg-sky-950/20' },
    { key: 'incidents', label: 'Incidents', helper: 'Signalés par le transporteur', tone: 'border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/20' },
    { key: 'pickup_ready', label: 'Retraits prêts', helper: 'Client attendu en boutique', tone: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20' },
  ]

  // One filter system: quick filters (fulfillment + queue views) and the
  // Statut / dates / paiement selects; each keeps the rest of the state.
  const quickFilters: { key: string; label: string; count?: number; active: boolean; href: string }[] = [
    { key: 'all', label: 'Tous', active: !filterView && !filters.fulfillment, href: buildHref(searchParams, { view: undefined, fulfillment: undefined }) },
    { key: 'delivery', label: 'Livraison', active: filters.fulfillment === 'delivery', href: buildHref(searchParams, { fulfillment: filters.fulfillment === 'delivery' ? undefined : 'delivery' }) },
    { key: 'pickup', label: 'Retrait', active: filters.fulfillment === 'pickup', href: buildHref(searchParams, { fulfillment: filters.fulfillment === 'pickup' ? undefined : 'pickup' }) },
    { key: 'urgent', label: 'Urgents', count: kpi('urgent'), active: filterView === 'urgent', href: buildHref(searchParams, { view: filterView === 'urgent' ? undefined : 'urgent', status: undefined }) },
    { key: 'incidents', label: 'Incidents', count: kpi('incidents'), active: filterView === 'incidents', href: buildHref(searchParams, { view: filterView === 'incidents' ? undefined : 'incidents', status: undefined }) },
    { key: 'finished', label: 'Terminés', active: filterView === 'finished', href: buildHref(searchParams, { view: filterView === 'finished' ? undefined : 'finished', status: undefined }) },
  ]

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
      {queue && !queue.priorityAvailable && <p role="status" className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Plus de 5 000 commandes actives : la liste est triée par date et les compteurs sont partiels.</p>}

      <section aria-labelledby="work-queue-title" className="mb-4 rounded-2xl border border-[var(--admin-border)] bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-4">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">À faire maintenant</p>
            <h2 id="work-queue-title" className="mt-1 text-base font-semibold text-gray-950 dark:text-gray-100">File de fulfillment</h2>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">Chaque carte filtre la liste ; un second clic l’annule.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {operationalViews.map(view => {
            const active = filterView === view.key
            const count = kpi(view.key as QueueKey)
            return (
              <AdminStatCard
                key={view.key}
                href={buildHref(searchParams, { view: active ? undefined : view.key, status: undefined })}
                title={view.label}
                value={count}
                description={view.helper}
                active={active}
                tone={view.key === 'incidents' ? 'danger' : view.key === 'preparing' || view.key === 'to_ship' ? 'warning' : view.key === 'in_transit' ? 'info' : view.key === 'pickup_ready' ? 'success' : 'brand'}
              />
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">Contrôles : préparation incomplète {Number(stats?.picking_incomplete_count ?? 0)} · emballage à terminer {Number(stats?.packing_pending_count ?? 0)} · suivi manquant {Number(stats?.tracking_missing_count ?? 0)} · chaîne du froid {Number(stats?.cold_chain_action_count ?? 0)} · paiement à vérifier {Number(stats?.pending_payment_count ?? 0)}</p>
      </section>

      {pendingPayments.length > 0 && <div className="mb-4"><PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} /></div>}
      {(preordersToVerifyCount ?? 0) > 0 && (
        <Link href="/admin/orders/precommandes" className="mb-4 flex min-h-11 items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{preordersToVerifyCount} précommande{(preordersToVerifyCount ?? 0) > 1 ? 's' : ''} avec un paiement à vérifier</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <section aria-label="Filtres des commandes" className="mb-3 rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-2 border-b border-[var(--admin-border)] p-2 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
          <nav className="flex gap-1 overflow-x-auto" aria-label="Filtres rapides">
            {quickFilters.map(item => (
              <Link key={item.key} href={item.href} aria-current={item.active ? 'page' : undefined}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-[var(--admin-primary)] ${item.active ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}>
                {item.label}
                {item.count !== undefined && item.count > 0 && <span className={`rounded-full px-1.5 text-[10px] ${item.key === 'incidents' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{item.count}</span>}
              </Link>
            ))}
          </nav>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <Suspense fallback={<div className="h-9" />}><AdminFilters currentStatus={filters.status} currentDateFrom={filters.dateFrom} currentDateTo={filters.dateTo} currentFulfillment={filters.fulfillment} currentPayment={filters.payment} statusCounts={statusCounts} hideFulfillment /></Suspense>
            {(activeFilterCount > 0 || filters.search) && <Link href={sortKey === 'priority' ? '/admin' : `/admin?sort=${sortKey}`} className="shrink-0 text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">Réinitialiser{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</Link>}
          </div>
        </div>

        <div className="flex flex-col gap-2 p-2 sm:p-3 lg:flex-row lg:items-center lg:justify-between">
          <form method="get" action="/admin" role="search" className="flex min-w-0 flex-1 items-center gap-2">
            {filters.status && <input type="hidden" name="status" value={filters.status} />}
            {filterView && <input type="hidden" name="view" value={filterView} />}
            {filters.dateFrom && <input type="hidden" name="dateFrom" value={filters.dateFrom} />}
            {filters.dateTo && <input type="hidden" name="dateTo" value={filters.dateTo} />}
            {filters.fulfillment && <input type="hidden" name="fulfillment" value={filters.fulfillment} />}
            {filters.payment && <input type="hidden" name="payment" value={filters.payment} />}
            {sortKey !== 'priority' && <input type="hidden" name="sort" value={sortKey} />}
            <div className="relative w-full max-w-xl"><IconSearch size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="search" name="q" defaultValue={filters.search} aria-label="Rechercher une commande" placeholder="Client, email, n° ou UUID de commande" className="h-10 w-full rounded-xl border border-[var(--admin-border)] bg-white pl-9 pr-9 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />{filters.search && <Link href={buildHref(searchParams, { q: undefined })} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"><IconX size={14} /></Link>}</div>
            <button type="submit" className="h-10 shrink-0 rounded-xl bg-[var(--admin-primary)] px-3 text-sm font-semibold text-white hover:opacity-90">Rechercher</button>
          </form>
          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">{filteredCount} résultat{filteredCount !== 1 ? 's' : ''}</p>
            <Suspense fallback={<div className="h-10 w-48" />}><OrdersSortSelect value={queue?.appliedSort ?? sortKey} /></Suspense>
          </div>
        </div>
      </section>

      {!queue
        ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">Impossible de charger les commandes. <Link href={pageHref(1)} className="font-bold underline">Réessayer</Link></div>
        : <OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} thresholds={thresholds} canManage={canManage} managedProviderAvailable={managedProviderAvailable} nowIso={now.toISOString()} originCountry={tenant.country} sort={queue.appliedSort} documentDefaults={documentDefaults} />}

      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-3 py-2.5 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">{pageStart}–{pageEnd} sur {filteredCount} commande{filteredCount !== 1 ? 's' : ''}</span>
        <nav className="flex items-center gap-1" aria-label="Pagination des commandes">
          {currentPage > 1 ? <Link href={pageHref(currentPage - 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 text-xs font-semibold text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-300"><IconChevronLeft size={14} /> Précédent</Link> : <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-100 px-2.5 text-xs font-semibold text-gray-300 dark:border-gray-800 dark:text-gray-600"><IconChevronLeft size={14} /> Précédent</span>}
          <span className="min-w-20 px-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-200">{currentPage} / {totalPages}</span>
          {currentPage < totalPages ? <Link href={pageHref(currentPage + 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 text-xs font-semibold text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-300">Suivant <IconChevronRight size={14} /></Link> : <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-100 px-2.5 text-xs font-semibold text-gray-300 dark:border-gray-800 dark:text-gray-600">Suivant <IconChevronRight size={14} /></span>}
        </nav>
      </div>
    </div>
  )
}
