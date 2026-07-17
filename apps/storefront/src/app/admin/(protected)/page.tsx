import { Suspense } from 'react'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import AdminFilters from './AdminFilters'
import OrdersTable from './OrdersTable'
import type { ListOrder } from './OrdersTable'

export const dynamic = 'force-dynamic'

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  href,
  delta,
}: {
  label:  string
  value:  string
  sub?:   string
  href?:  string
  delta?: number | null
}) {
  const inner = (
    <>
      <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {sub && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>}
      {delta != null && (
        <p className={`text-xs mt-0.5 ${delta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
          {delta >= 0 ? '+' : ''}{delta}%
        </p>
      )}
      {href && (
        <p className="text-xs mt-1" style={{ color: 'var(--color-primary-dark)' }}>
          Voir →
        </p>
      )}
    </>
  )

  if (href) {
    return (
      <Link href={href} className="block bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4 hover:shadow-md transition-shadow">
        {inner}
      </Link>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-4">
      {inner}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: {
    status?:      string
    period?:      string
    fulfillment?: string
    payment?:     string
  }
}

export default async function AdminPage({ searchParams }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'
  const tenant     = await getTenant(tenantSlug)
  const supabase   = createServiceClient()

  const filterStatus      = searchParams.status      ?? ''
  const filterPeriod      = searchParams.period      ?? 'all'
  const filterFulfillment = searchParams.fulfillment ?? ''
  const filterPayment     = searchParams.payment     ?? ''

  // ── KPI query (all paid orders, unfiltered) ─────────────────────────────────
  const { data: kpiOrders } = await supabase
    .from('orders')
    .select('total, created_at, status')
    .eq('tenant_id', tenant.id)
    .in('payment_status', ['paid'])

  const kpiData = kpiOrders ?? []

  const now          = new Date()
  const thisMonth    = now.getMonth()
  const thisYear     = now.getFullYear()
  const prevMonth    = thisMonth === 0 ? 11 : thisMonth - 1
  const prevYear     = thisMonth === 0 ? thisYear - 1 : thisYear

  const totalRevenue = kpiData.reduce((s, o) => s + o.total, 0)

  const thisMonthRevenue = kpiData
    .filter(o => {
      const d = new Date(o.created_at)
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear
    })
    .reduce((s, o) => s + o.total, 0)

  const prevMonthRevenue = kpiData
    .filter(o => {
      const d = new Date(o.created_at)
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear
    })
    .reduce((s, o) => s + o.total, 0)

  const delta = prevMonthRevenue === 0
    ? null
    : Math.round(((thisMonthRevenue - prevMonthRevenue) / prevMonthRevenue) * 100)

  // ── Count KPIs (unfiltered) ─────────────────────────────────────────────────
  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, status, created_at')
    .eq('tenant_id', tenant.id)

  const allData   = allOrders ?? []
  const totalCount = allData.length
  const toShip    = allData.filter(
    o => o.status === 'preparing' || o.status === 'ready_for_pickup'
  ).length

  // ── List query (filtered) ───────────────────────────────────────────────────
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

  if (filterStatus)      query = query.eq('status',           filterStatus)
  if (filterFulfillment) query = query.eq('fulfillment_type', filterFulfillment)
  if (filterPayment)     query = query.eq('payment_method',   filterPayment)

  if (filterPeriod && filterPeriod !== 'all') {
    const periodNow = new Date()
    if (filterPeriod === 'today') {
      const start = new Date(periodNow)
      start.setHours(0, 0, 0, 0)
      query = query.gte('created_at', start.toISOString())
    } else if (filterPeriod === 'week') {
      const start = new Date(periodNow.getTime() - 7 * 24 * 60 * 60 * 1000)
      query = query.gte('created_at', start.toISOString())
    } else if (filterPeriod === 'month') {
      const start = new Date(periodNow.getFullYear(), periodNow.getMonth(), 1)
      query = query.gte('created_at', start.toISOString())
    }
  }

  const { data: orders } = await query as { data: ListOrder[] | null }
  const orderList = orders ?? []

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Commandes</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {orderList.length} commande{orderList.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {/* ── KPI cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <KpiCard
            label="Commandes totales"
            value={String(totalCount)}
          />
          <KpiCard
            label="CA total"
            value={formatPrice(totalRevenue, tenant.currency)}
          />
          <KpiCard
            label="CA ce mois"
            value={formatPrice(thisMonthRevenue, tenant.currency)}
            delta={delta}
          />
          <KpiCard
            label="À expédier"
            value={String(toShip)}
            href="/admin?status=preparing"
          />
          <KpiCard
            label="Expédiées ce mois"
            value={String(
              allData.filter(o => {
                const d = new Date(o.created_at)
                return (
                  (o.status === 'shipped' || o.status === 'delivered') &&
                  d.getMonth()    === thisMonth &&
                  d.getFullYear() === thisYear
                )
              }).length
            )}
          />
        </div>

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm px-4 py-3 mb-4">
          <Suspense fallback={<div className="h-9" />}>
            <AdminFilters
              currentStatus={filterStatus}
              currentPeriod={filterPeriod}
              currentFulfillment={filterFulfillment}
              currentPayment={filterPayment}
            />
          </Suspense>
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <OrdersTable
          orders={orderList}
          tenantCurrency={tenant.currency}
        />

      </div>
    </div>
  )
}
