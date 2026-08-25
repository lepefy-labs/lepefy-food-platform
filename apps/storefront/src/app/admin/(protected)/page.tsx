import Link from 'next/link'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import {
  IconAlertTriangle,
  IconBuildingStore,
  IconChevronLeft,
  IconChevronRight,
  IconCurrencyEuro,
  IconPackage,
  IconSearch,
  IconSnowflake,
  IconTruck,
  IconX,
} from '@tabler/icons-react'
import AdminFilters from './AdminFilters'
import OrdersTable from './OrdersTable'
import PendingPaymentsBanner from './PendingPaymentsBanner'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import styles from './OrdersListPolish.module.css'
import type { ListOrder } from './OrdersTable'
import type { PendingPaymentSession } from './PendingPaymentsBanner'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const PAGE_SIZE = 50
const AGED_MS = 24 * 60 * 60 * 1000

type OrderView = '' | 'to_ship' | 'pickup_ready' | 'payment_pending' | 'aged' | 'cold_chain'
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
] as const

const VALID_VIEWS = new Set<OrderView>(['', 'to_ship', 'pickup_ready', 'payment_pending', 'aged', 'cold_chain'])
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

  const filterStatus = searchParams.status ?? ''
  const filterDateFrom = searchParams.dateFrom ?? ''
  const filterDateTo = searchParams.dateTo ?? ''
  const filterFulfillment = searchParams.fulfillment ?? ''
  const filterPayment = searchParams.payment ?? ''
  const searchQuery = sanitizeSearch(searchParams.q ?? '')
  const filterView = sanitizeView(searchParams.view)
  const sortKey = sanitizeSort(searchParams.sort)
  const requestedPage = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)
  const agedCutoffIso = new Date(Date.now() - AGED_MS).toISOString()

  const { data: kpiOrders } = await supabase
    .from('orders')
    .select('total, created_at, status')
    .eq('tenant_id', tenant.id)
    .in('payment_status', ['paid'])

  const kpiData = kpiOrders ?? []
  const now = new Date()
  const thisMonthRevenue = kpiData
    .filter(order => {
      const date = new Date(order.created_at)
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
    })
    .reduce((sum, order) => sum + order.total, 0)

  const { data: allOrdersRaw } = await supabase
    .from('orders')
    .select('id, status, created_at, fulfillment_type, payment_status, order_items(storage_type, quantity)')
    .eq('tenant_id', tenant.id)

  const allData = (allOrdersRaw ?? []) as Array<{
    id: string
    status: string
    created_at: string
    fulfillment_type: string
    payment_status: string
    order_items: Array<{ storage_type: string | null; quantity: number }> | null
  }>

  const totalCount = allData.length
  const newCount = allData.filter(order => order.status === 'new').length
  const toPrepare = allData.filter(order => order.status === 'preparing').length
  const readyForPickup = allData.filter(order => order.status === 'ready_for_pickup').length
  const toShipCount = allData.filter(order => order.status === 'preparing' && order.fulfillment_type === 'delivery').length
  const pendingPaymentCount = allData.filter(order => order.payment_status === 'pending').length
  const agedCount = allData.filter(order => !['delivered', 'cancelled'].includes(order.status) && new Date(order.created_at).getTime() <= new Date(agedCutoffIso).getTime()).length
  const coldChainCount = allData.filter(order => (order.order_items ?? []).some(item => item.storage_type === 'fresh' || item.storage_type === 'frozen')).length

  const statusCounts = allData.reduce<Record<string, number>>((acc, order) => {
    acc[order.status] = (acc[order.status] ?? 0) + 1
    return acc
  }, {})

  const itemRelation = filterView === 'cold_chain'
    ? 'order_items!inner(id, name, quantity, subtotal, storage_type, warehouse_location)'
    : 'order_items(id, name, quantity, subtotal, storage_type, warehouse_location)'

  let query = supabase
    .from('orders')
    .select(`
      id, created_at, email, full_name, status, total,
      subtotal, shipping_cost, payment_method, payment_status,
      fulfillment_type, shipping_address, shipping_details,
      ${itemRelation}
    `, { count: 'exact' })
    .eq('tenant_id', tenant.id)

  if (filterView === 'to_ship') {
    query = query.eq('status', 'preparing').eq('fulfillment_type', 'delivery')
  } else if (filterView === 'pickup_ready') {
    query = query.eq('status', 'ready_for_pickup')
  } else if (filterView === 'payment_pending') {
    query = query.eq('payment_status', 'pending')
  } else if (filterView === 'aged') {
    query = query.lte('created_at', agedCutoffIso).not('status', 'in', '(delivered,cancelled)')
  } else if (filterView === 'cold_chain') {
    query = query.in('order_items.storage_type', ['fresh', 'frozen'])
  } else {
    if (filterStatus) query = query.eq('status', filterStatus)
    if (filterFulfillment) query = query.eq('fulfillment_type', filterFulfillment)
    if (filterPayment) query = query.eq('payment_method', filterPayment)
  }

  if (filterDateFrom) query = query.gte('created_at', new Date(filterDateFrom).toISOString())
  if (filterDateTo) {
    const end = new Date(filterDateTo)
    end.setHours(23, 59, 59, 999)
    query = query.lte('created_at', end.toISOString())
  }

  if (searchQuery) {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (uuidPattern.test(searchQuery)) query = query.eq('id', searchQuery)
    else {
      const escaped = searchQuery.replace(/[%_]/g, '')
      query = query.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`)
    }
  }

  if (sortKey === 'date_asc') query = query.order('created_at', { ascending: true })
  else if (sortKey === 'total_desc') query = query.order('total', { ascending: false }).order('created_at', { ascending: false })
  else if (sortKey === 'total_asc') query = query.order('total', { ascending: true }).order('created_at', { ascending: false })
  else query = query.order('created_at', { ascending: false })

  const initialFrom = (requestedPage - 1) * PAGE_SIZE
  const initialTo = initialFrom + PAGE_SIZE - 1
  const firstResult = await query.range(initialFrom, initialTo) as { data: ListOrder[] | null; count: number | null }
  const filteredCount = firstResult.count ?? 0
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)

  let orderList = firstResult.data ?? []
  if (currentPage !== requestedPage) {
    const from = (currentPage - 1) * PAGE_SIZE
    const corrected = await query.range(from, from + PAGE_SIZE - 1) as { data: ListOrder[] | null }
    orderList = corrected.data ?? []
  }

  const { data: carriersRaw } = await supabase
    .from('carriers')
    .select('name')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position', { ascending: true })
  const carriers = ((carriersRaw ?? []) as { name: string }[]).map(carrier => carrier.name)

  const { data: pendingPaymentsRaw } = await supabase
    .from('checkout_sessions')
    .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, external_payment_type, external_payment_label, created_at')
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .order('created_at', { ascending: true })
  const pendingPayments = (pendingPaymentsRaw ?? []) as PendingPaymentSession[]

  const activeFilterCount = [filterDateFrom, filterDateTo, filterFulfillment, filterPayment, filterView].filter(Boolean).length
  const pageStart = filteredCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredCount)

  const compactKpis = [
    { label: 'Nouvelles', value: String(newCount), helper: 'À prendre en charge', href: '/admin?status=new', icon: IconPackage, tone: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40' },
    { label: 'À préparer', value: String(toPrepare), helper: 'Préparation en cours', href: '/admin?status=preparing', icon: IconTruck, tone: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40' },
    { label: 'Prêtes au retrait', value: String(readyForPickup), helper: 'Client attendu', href: '/admin?status=ready_for_pickup', icon: IconBuildingStore, tone: 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/40' },
    { label: 'À surveiller +24 h', value: String(agedCount), helper: 'Commandes actives anciennes', href: '/admin?view=aged', icon: IconAlertTriangle, tone: 'text-red-700 bg-red-50 dark:text-red-300 dark:bg-red-950/40' },
    { label: 'CA ce mois', value: formatPrice(thisMonthRevenue, tenant.currency), helper: 'Commandes payées', href: '/admin', icon: IconCurrencyEuro, tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40' },
  ]

  const quickViews: { key: OrderView; label: string; count: number; helper: string }[] = [
    { key: 'to_ship', label: 'Livraisons à expédier', count: toShipCount, helper: 'En préparation · livraison' },
    { key: 'pickup_ready', label: 'Retraits prêts', count: readyForPickup, helper: 'Client attendu en boutique' },
    { key: 'cold_chain', label: 'Chaîne du froid', count: coldChainCount, helper: 'Frais ou surgelés' },
    { key: 'payment_pending', label: 'Paiements en attente', count: pendingPaymentCount, helper: 'Action de paiement requise' },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl pb-8">
      <AdminPageHeader title="Commandes" description="Traitez d'abord les commandes qui demandent votre attention." meta={`${totalCount} commande${totalCount !== 1 ? 's' : ''}`} />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {compactKpis.map(kpi => {
          const Icon = kpi.icon
          return (
            <Link key={kpi.label} href={kpi.href} className="group flex min-h-[78px] items-center gap-3 rounded-xl border border-[var(--admin-border)] bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-[#D9D3FF] hover:bg-[var(--admin-surface-subtle)] dark:border-gray-800 dark:bg-gray-900">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kpi.tone}`}><Icon size={18} stroke={1.8} /></span>
              <span className="min-w-0"><span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{kpi.label}</span><span className="mt-0.5 block truncate text-lg font-bold leading-none text-gray-950 dark:text-gray-50">{kpi.value}</span><span className="mt-1 hidden truncate text-[11px] text-gray-400 sm:block">{kpi.helper}</span></span>
            </Link>
          )
        })}
      </div>

      {pendingPayments.length > 0 && <div className="mb-4"><PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} /></div>}

      <section className="mb-3 overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-[var(--admin-border)] p-3 dark:border-gray-800">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {quickViews.map(view => {
              const active = filterView === view.key
              return (
                <Link key={view.key} href={buildViewHref(searchParams, active ? '' : view.key)} className={`rounded-xl border px-3 py-2.5 transition-colors ${active ? 'border-[#C9C1FF] bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]' : view.key === 'cold_chain' && view.count > 0 ? 'border-sky-200 bg-sky-50/60 text-sky-800 hover:bg-sky-50 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-200' : 'border-gray-200 bg-gray-50/70 text-gray-700 hover:border-[#D9D3FF] hover:bg-[#FAF9FF] dark:border-gray-700 dark:bg-gray-950/50 dark:text-gray-200'}`}>
                  <span className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-xs font-semibold">{view.key === 'cold_chain' && <IconSnowflake size={13} />}{view.label}</span><span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? 'bg-white/80' : 'bg-white dark:bg-gray-900'}`}>{view.count}</span></span>
                  <span className="mt-1 block text-[11px] text-gray-400">{view.helper}</span>
                </Link>
              )
            })}
          </div>
        </div>

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
          {filterFulfillment && !filterView && <input type="hidden" name="fulfillment" value={filterFulfillment} />}
          {filterPayment && !filterView && <input type="hidden" name="payment" value={filterPayment} />}
          {sortKey !== 'date_desc' && <input type="hidden" name="sort" value={sortKey} />}
          <div className="relative w-full max-w-xl"><IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="search" name="q" defaultValue={searchQuery} placeholder="Client, email ou UUID de commande..." className="h-10 w-full rounded-xl border border-[var(--admin-border)] bg-white pl-9 pr-9 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100" />{searchQuery && <Link href={buildPageHref({ ...searchParams, q: undefined, page: undefined }, 1)} aria-label="Effacer la recherche" className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100"><IconX size={14} /></Link>}</div>
          <button type="submit" className="h-10 shrink-0 rounded-xl bg-[var(--admin-primary)] px-3 text-sm font-semibold text-white hover:opacity-90">Rechercher</button>
        </form>

        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{filteredCount} résultat{filteredCount !== 1 ? 's' : ''}</p>
          <div className="flex items-center gap-1 rounded-lg border border-[var(--admin-border)] bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-950">
            {([['date_desc', 'Plus récentes'], ['date_asc', 'Plus anciennes'], ['total_desc', 'Montant ↓'], ['total_asc', 'Montant ↑']] as [SortKey, string][]).map(([key, label]) => <Link key={key} href={buildSortHref(searchParams, key)} className={`rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors ${sortKey === key ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200'}`}>{label}</Link>)}
          </div>
        </div>
      </div>

      <div className={`${styles.listPolish} [&>div>div:first-of-type]:hidden`}><OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} /></div>

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
