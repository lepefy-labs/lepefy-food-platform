import { Suspense } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import {
  IconClock,
  IconCurrencyEuro,
  IconTrendingUp,
  IconTruck,
  IconTruckDelivery,
} from '@tabler/icons-react'
import AdminFilters from './AdminFilters'
import OrdersTable from './OrdersTable'
import PendingPaymentsBanner from './PendingPaymentsBanner'
import KpiCard from '../_components/ui/KpiCard'
import type { ListOrder } from './OrdersTable'
import type { PendingPaymentSession } from './PendingPaymentsBanner'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store';

// ─── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: {
    status?:      string
    dateFrom?:    string
    dateTo?:      string
    fulfillment?: string
    payment?:     string
  }
}

export default async function AdminPage({ searchParams }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'
  const tenant     = await getTenant(tenantSlug)
  const supabase   = createServiceClient()

  const filterStatus      = searchParams.status      ?? ''
  const filterDateFrom    = searchParams.dateFrom     ?? ''
  const filterDateTo      = searchParams.dateTo       ?? ''
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
  const todayCount = allData.filter(o => {
    const d = new Date(o.created_at)
    return d.toDateString() === now.toDateString()
  }).length
  const toShip    = allData.filter(
    o => o.status === 'preparing' || o.status === 'ready_for_pickup'
  ).length

  const statusCounts = allData.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1
    return acc
  }, {})

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

  if (filterDateFrom) {
    query = query.gte('created_at', new Date(filterDateFrom).toISOString())
  }
  if (filterDateTo) {
    // fine giornata inclusa, altrimenti "à" esclude gli ordini dello stesso giorno
    const end = new Date(filterDateTo)
    end.setHours(23, 59, 59, 999)
    query = query.lte('created_at', end.toISOString())
  }

  const { data: orders } = await query as { data: ListOrder[] | null }
  const orderList = orders ?? []

  // Stessa query di (protected)/orders/[id]/page.tsx — lista trasportatori
  // per il pannello di compilazione tracking nella bulk bar.
  const { data: carriersRaw } = await supabase
    .from('carriers')
    .select('name')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position', { ascending: true })

  const carriers = ((carriersRaw ?? []) as { name: string }[]).map(c => c.name)

  // ── Paiements en attente (Phase 1 — lien externe) ───────────────────────────
  // Aucune commande n'existe encore pour ces lignes : simple demande, stock
  // non réservé — voir bandeau ci-dessous et createOrderFromCheckoutSession.
  const { data: pendingPaymentsRaw } = await supabase
    .from('checkout_sessions')
    .select('id, email, full_name, items, shipping_total, ambassador_discount_amount, external_payment_type, external_payment_label, created_at')
    .eq('tenant_id', tenant.id)
    .eq('payment_method', 'external_link')
    .order('created_at', { ascending: true })

  const pendingPayments = (pendingPaymentsRaw ?? []) as PendingPaymentSession[]

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

        {/* ── Paiements en attente (Phase 1 — lien externe) ──────────────────── */}
        {pendingPayments.length > 0 && (
          <PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} />
        )}

        {/* ── KPI cards ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
          <KpiCard
            label="Aujourd'hui"
            value={String(todayCount)}
            sub={`${totalCount} au total`}
            icon={IconClock}
            tone="info"
          />
          <KpiCard
            label="CA total"
            value={formatPrice(totalRevenue, tenant.currency)}
            icon={IconCurrencyEuro}
            tone="primary"
          />
          <KpiCard
            label="CA ce mois"
            value={formatPrice(thisMonthRevenue, tenant.currency)}
            delta={delta}
            icon={IconTrendingUp}
            tone="primary"
          />
          <KpiCard
            label="À expédier"
            value={String(toShip)}
            href="/admin?status=preparing"
            icon={IconTruck}
            tone="warn"
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
            icon={IconTruckDelivery}
            tone="success"
          />
        </div>

        {/* ── Filter bar ──────────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm px-4 py-3 mb-4">
          <Suspense fallback={<div className="h-9" />}>
            <AdminFilters
              currentStatus={filterStatus}
              currentDateFrom={filterDateFrom}
              currentDateTo={filterDateTo}
              currentFulfillment={filterFulfillment}
              currentPayment={filterPayment}
              statusCounts={statusCounts}
            />
          </Suspense>
        </div>

        {/* ── Table ───────────────────────────────────────────────────────── */}
        <OrdersTable
          orders={orderList}
          tenantCurrency={tenant.currency}
          carriers={carriers}
        />

      </div>
    </div>
  )
}
