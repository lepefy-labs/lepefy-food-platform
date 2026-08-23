import Link from 'next/link'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import AdminFilters from './AdminFilters'
import OrdersTable from './OrdersTable'
import PendingPaymentsBanner from './PendingPaymentsBanner'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import type { ListOrder } from './OrdersTable'
import type { PendingPaymentSession } from './PendingPaymentsBanner'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface PageProps {
  searchParams: {
    status?: string
    dateFrom?: string
    dateTo?: string
    fulfillment?: string
    payment?: string
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

function buildStatusHref(searchParams: PageProps['searchParams'], status: string) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (searchParams.dateFrom) params.set('dateFrom', searchParams.dateFrom)
  if (searchParams.dateTo) params.set('dateTo', searchParams.dateTo)
  if (searchParams.fulfillment) params.set('fulfillment', searchParams.fulfillment)
  if (searchParams.payment) params.set('payment', searchParams.payment)
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
  const todayCount = allData.filter(order => new Date(order.created_at).toDateString() === now.toDateString()).length
  const actionCount = allData.filter(order => ['new', 'preparing', 'ready_for_pickup'].includes(order.status)).length
  const toPrepare = allData.filter(order => order.status === 'preparing').length

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
    `)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(500)

  if (filterStatus) query = query.eq('status', filterStatus)
  if (filterFulfillment) query = query.eq('fulfillment_type', filterFulfillment)
  if (filterPayment) query = query.eq('payment_method', filterPayment)
  if (filterDateFrom) query = query.gte('created_at', new Date(filterDateFrom).toISOString())
  if (filterDateTo) {
    const end = new Date(filterDateTo)
    end.setHours(23, 59, 59, 999)
    query = query.lte('created_at', end.toISOString())
  }

  const { data: orders } = await query as { data: ListOrder[] | null }
  const orderList = orders ?? []

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

  return (
    <div className="mx-auto w-full max-w-7xl pb-8">
      <AdminPageHeader
        title="Commandes"
        description="Traitez rapidement les commandes qui demandent votre attention."
        meta={`${totalCount} commande${totalCount !== 1 ? 's' : ''}`}
      />

      <div className="-mt-2 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
        <span><strong className="font-semibold text-gray-900 dark:text-gray-100">{actionCount}</strong> à traiter</span>
        <span><strong className="font-semibold text-amber-700 dark:text-amber-300">{toPrepare}</strong> à préparer</span>
        <span><strong className="font-semibold text-gray-900 dark:text-gray-100">{todayCount}</strong> aujourd&apos;hui</span>
        <span><strong className="font-semibold text-gray-900 dark:text-gray-100">{formatPrice(thisMonthRevenue, tenant.currency)}</strong> ce mois</span>
      </div>

      {pendingPayments.length > 0 && (
        <div className="mb-4">
          <PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} />
        </div>
      )}

      <section className="mb-3 rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--admin-border)] px-2 py-2 dark:border-gray-800 sm:px-3" aria-label="Statuts des commandes">
          {STATUS_TABS.map(tab => {
            const active = filterStatus === tab.key
            const count = tab.key ? (statusCounts[tab.key] ?? 0) : totalCount
            return (
              <Link
                key={tab.key || 'all'}
                href={buildStatusHref(searchParams, tab.key)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
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

        <div className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
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

          {(filterStatus || activeFilterCount > 0) && (
            <Link href="/admin" className="shrink-0 text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">
              Réinitialiser{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Link>
          )}
        </div>
      </section>

      <div className="[&_thead_th]:py-2.5 [&_tbody_td]:py-2.5 [&_tbody_tr]:align-middle [&_ul>li>a]:p-3">
        <OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} />
      </div>
    </div>
  )
}
