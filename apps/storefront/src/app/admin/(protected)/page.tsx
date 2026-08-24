import Link from 'next/link'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import {
  IconBuildingStore,
  IconChevronLeft,
  IconChevronRight,
  IconCurrencyEuro,
  IconPackage,
  IconSearch,
  IconTruck,
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

interface PageProps {
  searchParams: {
    status?: string
    dateFrom?: string
    dateTo?: string
    fulfillment?: string
    payment?: string
    q?: string
    page?: string
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

function sanitizeSearch(raw: string) {
  return raw.trim().replace(/[^a-zA-Z0-9À-ÿ@._\- ]/g, '').slice(0, 60)
}

function appendSharedParams(params: URLSearchParams, searchParams: PageProps['searchParams']) {
  if (searchParams.dateFrom) params.set('dateFrom', searchParams.dateFrom)
  if (searchParams.dateTo) params.set('dateTo', searchParams.dateTo)
  if (searchParams.fulfillment) params.set('fulfillment', searchParams.fulfillment)
  if (searchParams.payment) params.set('payment', searchParams.payment)
  if (searchParams.q) params.set('q', sanitizeSearch(searchParams.q))
}

function buildStatusHref(searchParams: PageProps['searchParams'], status: string) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  appendSharedParams(params, searchParams)
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
  const requestedPage = Math.max(1, Number.parseInt(searchParams.page ?? '1', 10) || 1)

  const { data: kpiOrders } = await supabase
    .from('orders')
    .select('total, created_at, status')
    .eq('tenant_id', tenant.id)
    .in('payment_status', ['paid'])

  const kpiData = kpiOrders ?? []
  const now = new Date()
  const thisMonth = now.getMonth()
  const thisYear = now.getFullYear()

  const thisMonthRevenue = kpiData
    .filter(order => {
      const date = new Date(order.created_at)
      return date.getMonth() === thisMonth && date.getFullYear() === thisYear
    })
    .reduce((sum, order) => sum + order.total, 0)

  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, status, created_at')
    .eq('tenant_id', tenant.id)

  const allData = allOrders ?? []
  const totalCount = allData.length
  const newCount = allData.filter(order => order.status === 'new').length
  const toPrepare = allData.filter(order => order.status === 'preparing').length
  const readyForPickup = allData.filter(order => order.status === 'ready_for_pickup').length

  const statusCounts = allData.reduce<Record<string, number>>((acc, order) => {
    acc[order.status] = (acc[order.status] ?? 0) + 1
    return acc
  }, {})

  let query = supabase
    .from('orders')
    .select(`
      id, created_at, email, full_name, status, total,
      subtotal, shipping_cost, payment_method, payment_status,
      fulfillment_type, shipping_address, shipping_details,
      order_items(id, name, quantity, subtotal, storage_type)
    `, { count: 'exact' })
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })

  if (filterStatus) query = query.eq('status', filterStatus)
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
    if (uuidPattern.test(searchQuery)) {
      query = query.eq('id', searchQuery)
    } else {
      const escaped = searchQuery.replace(/[%_]/g, '')
      query = query.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%`)
    }
  }

  const initialFrom = (requestedPage - 1) * PAGE_SIZE
  const initialTo = initialFrom + PAGE_SIZE - 1
  const firstResult = await query.range(initialFrom, initialTo) as {
    data: ListOrder[] | null
    count: number | null
  }

  const filteredCount = firstResult.count ?? 0
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE))
  const currentPage = Math.min(requestedPage, totalPages)

  let orderList = firstResult.data ?? []
  if (currentPage !== requestedPage) {
    const from = (currentPage - 1) * PAGE_SIZE
    const to = from + PAGE_SIZE - 1
    const corrected = await query.range(from, to) as { data: ListOrder[] | null }
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

  const activeFilterCount = [filterDateFrom, filterDateTo, filterFulfillment, filterPayment].filter(Boolean).length
  const pageStart = filteredCount === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const pageEnd = Math.min(currentPage * PAGE_SIZE, filteredCount)

  const compactKpis = [
    {
      label: 'Nouvelles',
      value: String(newCount),
      helper: 'À prendre en charge',
      href: '/admin?status=new',
      icon: IconPackage,
      tone: 'text-violet-700 bg-violet-50 dark:text-violet-300 dark:bg-violet-950/40',
    },
    {
      label: 'À préparer',
      value: String(toPrepare),
      helper: 'Préparation en cours',
      href: '/admin?status=preparing',
      icon: IconTruck,
      tone: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40',
    },
    {
      label: 'Prêtes au retrait',
      value: String(readyForPickup),
      helper: 'En attente du client',
      href: '/admin?status=ready_for_pickup',
      icon: IconBuildingStore,
      tone: 'text-sky-700 bg-sky-50 dark:text-sky-300 dark:bg-sky-950/40',
    },
    {
      label: 'CA ce mois',
      value: formatPrice(thisMonthRevenue, tenant.currency),
      helper: 'Commandes payées',
      href: '/admin',
      icon: IconCurrencyEuro,
      tone: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/40',
    },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl pb-8">
      <AdminPageHeader
        title="Commandes"
        description="Traitez rapidement les commandes qui demandent votre attention."
        meta={`${totalCount} commande${totalCount !== 1 ? 's' : ''}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {compactKpis.map(kpi => {
          const Icon = kpi.icon
          return (
            <Link
              key={kpi.label}
              href={kpi.href}
              className="group flex min-h-[78px] items-center gap-3 rounded-xl border border-[var(--admin-border)] bg-white px-3 py-2.5 shadow-sm transition-colors hover:border-[#D9D3FF] hover:bg-[var(--admin-surface-subtle)] dark:border-gray-800 dark:bg-gray-900"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${kpi.tone}`}>
                <Icon size={18} stroke={1.8} />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{kpi.label}</span>
                <span className="mt-0.5 block truncate text-lg font-bold leading-none text-gray-950 dark:text-gray-50">{kpi.value}</span>
                <span className="mt-1 hidden truncate text-[11px] text-gray-400 sm:block">{kpi.helper}</span>
              </span>
            </Link>
          )
        })}
      </div>

      {pendingPayments.length > 0 && (
        <div className="mb-3">
          <PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} />
        </div>
      )}

      <section className="mb-2 rounded-xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] px-2 py-1.5 dark:border-gray-800 sm:px-3" aria-label="Statuts des commandes">
          {STATUS_TABS.map(tab => {
            const active = filterStatus === tab.key
            const count = tab.key ? (statusCounts[tab.key] ?? 0) : totalCount
            return (
              <Link
                key={tab.key || 'all'}
                href={buildStatusHref(searchParams, tab.key)}
                className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]'
                    : tab.key === 'preparing' && count > 0
                      ? 'text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40'
                      : 'text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                }`}
              >
                {tab.label}
                <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] ${
                  active
                    ? 'bg-white/80 dark:bg-gray-900/70'
                    : tab.key === 'preparing' && count > 0
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : 'bg-gray-100 dark:bg-gray-800'
                }`}>
                  {count}
                </span>
              </Link>
            )
          })}
        </div>

        <div className="flex flex-col gap-2 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
          <Suspense fallback={<div className="h-9" />}>
            <AdminFilters
              currentStatus={filterStatus}
              currentDateFrom={filterDateFrom}
              currentDateTo={filterDateTo}
              currentFulfillment={filterFulfillment}
              currentPayment={filterPayment}
              statusCounts={statusCounts}
              hideStatus
            />
          </Suspense>

          {(filterStatus || activeFilterCount > 0 || searchQuery) && (
            <Link href="/admin" className="shrink-0 text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">
              Réinitialiser{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Link>
          )}
        </div>
      </section>

      <div className="mb-3 flex flex-col gap-2 rounded-xl border border-[var(--admin-border)] bg-white p-3 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
        <form method="get" action="/admin" className="flex min-w-0 flex-1 items-center gap-2">
          {filterStatus && <input type="hidden" name="status" value={filterStatus} />}
          {filterDateFrom && <input type="hidden" name="dateFrom" value={filterDateFrom} />}
          {filterDateTo && <input type="hidden" name="dateTo" value={filterDateTo} />}
          {filterFulfillment && <input type="hidden" name="fulfillment" value={filterFulfillment} />}
          {filterPayment && <input type="hidden" name="payment" value={filterPayment} />}
          <div className="relative w-full max-w-xl">
            <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="search"
              name="q"
              defaultValue={searchQuery}
              placeholder="Rechercher dans toutes les commandes (client, email ou UUID)..."
              className="h-10 w-full rounded-lg border border-[var(--admin-border)] bg-white pl-9 pr-9 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[var(--admin-primary)] dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100"
            />
            {searchQuery && (
              <Link
                href={buildPageHref({ ...searchParams, q: undefined, page: undefined }, 1)}
                aria-label="Effacer la recherche"
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <IconX size={14} />
              </Link>
            )}
          </div>
          <button type="submit" className="h-10 shrink-0 rounded-lg bg-[var(--admin-primary)] px-3 text-sm font-semibold text-white hover:opacity-90">
            Rechercher
          </button>
        </form>
        <p className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {filteredCount} résultat{filteredCount !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="[&>div>div:first-of-type]:hidden [&_thead_th]:py-2.5 [&_tbody_td]:py-2.5 [&_tbody_tr]:align-middle [&_ul>li>a]:p-3">
        <OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} />
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[var(--admin-border)] bg-white px-3 py-2.5 text-sm shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {pageStart}–{pageEnd} sur {filteredCount} commande{filteredCount !== 1 ? 's' : ''}
        </span>
        <nav className="flex items-center gap-1" aria-label="Pagination des commandes">
          {currentPage > 1 ? (
            <Link href={buildPageHref(searchParams, currentPage - 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 text-xs font-semibold text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-300">
              <IconChevronLeft size={14} /> Précédent
            </Link>
          ) : (
            <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-100 px-2.5 text-xs font-semibold text-gray-300 dark:border-gray-800 dark:text-gray-600">
              <IconChevronLeft size={14} /> Précédent
            </span>
          )}
          <span className="min-w-20 px-2 text-center text-xs font-semibold text-gray-700 dark:text-gray-200">
            {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link href={buildPageHref(searchParams, currentPage + 1)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-[var(--admin-border)] px-2.5 text-xs font-semibold text-gray-600 hover:bg-[var(--admin-surface-subtle)] dark:border-gray-700 dark:text-gray-300">
              Suivant <IconChevronRight size={14} />
            </Link>
          ) : (
            <span className="inline-flex h-9 items-center gap-1 rounded-lg border border-gray-100 px-2.5 text-xs font-semibold text-gray-300 dark:border-gray-800 dark:text-gray-600">
              Suivant <IconChevronRight size={14} />
            </span>
          )}
        </nav>
      </div>
    </div>
  )
}
