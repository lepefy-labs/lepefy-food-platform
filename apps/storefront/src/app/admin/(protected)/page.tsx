import Link from 'next/link'
import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import {
  IconClock,
  IconCurrencyEuro,
  IconPackage,
  IconTruck,
} from '@tabler/icons-react'
import AdminFilters from './AdminFilters'
import OrdersTable from './OrdersTable'
import PendingPaymentsBanner from './PendingPaymentsBanner'
import KpiCard from '../_components/ui/KpiCard'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import AdminBlockAccent from '../_components/ui/AdminBlockAccent'
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

  const totalRevenue = kpiData.reduce((sum, order) => sum + order.total, 0)
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
  const toShip = allData.filter(order => order.status === 'preparing').length

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
    <div className="mx-auto w-full max-w-7xl pb-10">
      <AdminPageHeader
        title="Commandes"
        description="Traitez les commandes par priorité, vérifiez les paiements et préparez les expéditions depuis un seul espace."
        meta={`${totalCount} au total`}
      />

      {pendingPayments.length > 0 && (
        <div className="mb-5">
          <PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} />
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Aujourd'hui" value={String(todayCount)} sub="Nouvelles commandes" icon={IconClock} tone="info" />
        <KpiCard label="À traiter" value={String(actionCount)} sub="Nouvelles, préparation, retrait" icon={IconPackage} tone="warn" href="/admin?status=new" />
        <KpiCard label="À expédier" value={String(toShip)} sub="En préparation" icon={IconTruck} tone="warn" href="/admin?status=preparing" />
        <KpiCard label="CA ce mois" value={formatPrice(thisMonthRevenue, tenant.currency)} sub={`${formatPrice(totalRevenue, tenant.currency)} au total`} icon={IconCurrencyEuro} tone="primary" />
      </div>

      <AdminBlockAccent tone="primary" className="mb-5">
        <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-[var(--admin-border)] px-3 pt-3 dark:border-gray-800 sm:px-4">
            <div className="flex gap-1 overflow-x-auto pb-3" aria-label="Statuts des commandes">
              {STATUS_TABS.map(tab => {
                const active = filterStatus === tab.key
                const count = tab.key ? (statusCounts[tab.key] ?? 0) : totalCount
                return (
                  <Link
                    key={tab.key || 'all'}
                    href={buildStatusHref(searchParams, tab.key)}
                    className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)] ring-1 ring-[#D9D3FF]'
                        : 'text-gray-500 hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                  >
                    {tab.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${active ? 'bg-white/80' : 'bg-gray-100 dark:bg-gray-800'}`}>
                      {count}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>

          <div className="px-3 py-3 sm:px-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Affiner la liste</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Livraison, paiement et période{activeFilterCount ? ` · ${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''} actif${activeFilterCount > 1 ? 's' : ''}` : ''}
                </p>
              </div>
              {(filterStatus || activeFilterCount > 0) && (
                <Link href="/admin" className="text-xs font-medium text-[var(--admin-primary-fg)] hover:underline">
                  Réinitialiser
                </Link>
              )}
            </div>
            <Suspense fallback={<div className="h-10" />}>
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
          </div>
        </section>
      </AdminBlockAccent>

      <OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} />
    </div>
  )
}
