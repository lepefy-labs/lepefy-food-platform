import { Suspense } from 'react'
import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { formatPrice } from '@/lib/utils/format'
import { formatDate } from '@/lib/utils/format'
import type { OrderStatus } from '@lepefy/types'
import AdminFilters from './AdminFilters'
import CopyTrackingButton from '../CopyTrackingButton'

export const dynamic = 'force-dynamic'

// ─── Local types ──────────────────────────────────────────────────────────────

interface ShippingAddress {
  city?:        string
  postal_code?: string
  country?:     string
}

interface OrderItemRow {
  id:           string
  name:         string
  quantity:     number
  subtotal:     number
  storage_type: string | null
}

interface ListOrder {
  id:               string
  created_at:       string
  full_name:        string | null
  email:            string
  fulfillment_type: 'delivery' | 'pickup'
  shipping_address: ShippingAddress | null
  subtotal:         number
  shipping_cost:    number
  total:            number
  payment_method:   string | null
  payment_status:   string
  status:           OrderStatus
  order_items:      OrderItemRow[]
}

// ─── SVG Flags ────────────────────────────────────────────────────────────────

const FLAGS: Record<string, string> = {
  FR: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#002395"/><rect x="1" width="1" height="2" fill="#fff"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
  BE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="1" height="2" fill="#000"/><rect x="1" width="1" height="2" fill="#FAE042"/><rect x="2" width="1" height="2" fill="#ED2939"/></svg>`,
  DE: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 3"><rect width="5" height="3" fill="#FFCE00"/><rect width="5" height="2" fill="#000"/><rect width="5" height="1" fill="#DD0000"/></svg>`,
  CH: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#FF0000"/><rect x="13" y="6" width="6" height="20" fill="#fff"/><rect x="6" y="13" width="20" height="6" fill="#fff"/></svg>`,
  LU: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#EF3340"/><rect y="0.667" width="3" height="0.666" fill="#fff"/><rect y="1.333" width="3" height="0.667" fill="#00A3E0"/></svg>`,
  NL: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AE1C28"/><rect y="0.667" width="3" height="0.666" fill="#fff"/><rect y="1.333" width="3" height="0.667" fill="#21468B"/></svg>`,
  ES: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#AA151B"/><rect y="0.5" width="3" height="1" fill="#F1BF00"/></svg>`,
  PT: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 2"><rect width="3" height="2" fill="#FF0000"/><rect width="1.2" height="2" fill="#006600"/></svg>`,
}

function FlagBadge({ country }: { country: string }) {
  const svg = FLAGS[country.toUpperCase()]
  if (!svg) return <span className="text-xs text-gray-500">{country}</span>
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
      style={{ background: '#FEF3C7', color: '#92400E', border: '0.5px solid #FDE68A' }}
    >
      <span
        className="inline-block w-4 h-3 rounded-sm overflow-hidden"
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ lineHeight: 0 }}
      />
      {country.toUpperCase()}
    </span>
  )
}

// ─── Storage tag ──────────────────────────────────────────────────────────────

function StorageTag({ type }: { type: string | null }) {
  if (type === 'frozen') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium"
        style={{ background: '#EFF6FF', color: '#1D4ED8', border: '0.5px solid #BFDBFE' }}>
        ❄ surgelé
      </span>
    )
  }
  if (type === 'fresh') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs font-medium"
        style={{ background: '#F0FDF4', color: '#15803D', border: '0.5px solid #BBF7D0' }}>
        🌿 frais
      </span>
    )
  }
  return null
}

// ─── Destination cell ─────────────────────────────────────────────────────────

function DestinationCell({
  fulfillmentType,
  shippingAddress,
}: {
  fulfillmentType: string
  shippingAddress: ShippingAddress | null
}) {
  if (fulfillmentType === 'pickup') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
        style={{ background: '#EFF6FF', color: '#1E40AF', border: '0.5px solid #BFDBFE' }}>
        🏪 C&amp;C
      </span>
    )
  }
  if (!shippingAddress) return <span className="text-gray-400 text-xs">—</span>

  const country = shippingAddress.country ?? ''
  const isIT    = country.toUpperCase() === 'IT' || country === ''

  if (isIT) {
    return (
      <span className="text-xs text-gray-500">
        {shippingAddress.postal_code && (
          <span className="font-mono">{shippingAddress.postal_code}</span>
        )}
        {shippingAddress.city && <span className="ml-1">{shippingAddress.city}</span>}
      </span>
    )
  }

  return <FlagBadge country={country} />
}

// ─── Products cell ────────────────────────────────────────────────────────────

function ProductsCell({ items }: { items: OrderItemRow[] }) {
  const visible = items.slice(0, 3)
  const extra   = items.length - 3

  return (
    <div className="space-y-0.5">
      {visible.map((item, i) => (
        <div key={i} className="flex items-center gap-1 text-xs text-gray-700">
          <span>{item.name} ×{item.quantity}</span>
          <StorageTag type={item.storage_type} />
        </div>
      ))}
      {extra > 0 && (
        <span className="text-xs text-gray-400">+ {extra} autre{extra > 1 ? 's' : ''}</span>
      )}
    </div>
  )
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string }> = {
  new:              { bg: '#F0F9FF', color: '#0369A1', border: '#BAE6FD' },
  preparing:        { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
  ready_for_pickup: { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' },
  shipped:          { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  delivered:        { bg: '#F0FDF4', color: '#166534', border: '#A7F3D0' },
  cancelled:        { bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA' },
}

const STATUS_LABELS: Record<string, string> = {
  new:              'Nouveau',
  preparing:        'En préparation',
  ready_for_pickup: 'Prêt à retirer',
  shipped:          'Expédié',
  delivered:        'Livré',
  cancelled:        'Annulé',
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS_STYLE[status] ?? { bg: '#F3F4F6', color: '#374151', border: '#D1D5DB' }
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: s.bg, color: s.color, border: `0.5px solid ${s.border}` }}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

// ─── Payment badge ────────────────────────────────────────────────────────────

function PaymentBadge({ method }: { method: string | null }) {
  if (method === 'stripe') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
        💳 Carte
      </span>
    )
  }
  if (method === 'satispay') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-700">
        🟠 Satispay
      </span>
    )
  }
  if (method === 'in_store') {
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
        🏪 En magasin
      </span>
    )
  }
  return <span className="text-gray-300">—</span>
}

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
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {delta != null && (
        <p className={`text-xs mt-0.5 ${delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
          {delta >= 0 ? '+' : ''}{delta}%
        </p>
      )}
      {href && (
        <p className="text-xs mt-1" style={{ color: 'var(--color-primary)' }}>
          Voir →
        </p>
      )}
    </>
  )

  if (href) {
    return (
      <Link href={href} className="block bg-white rounded-2xl border border-gray-100 shadow-sm p-4 hover:shadow-md transition-shadow">
        {inner}
      </Link>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
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
    .select('*, order_items(id, name, quantity, subtotal, storage_type)')
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

  const todayStr = now.toDateString()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Commandes</h1>
            <p className="text-sm text-gray-500 mt-0.5">
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
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 mb-4">
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
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">N°</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                  <th className="hidden md:table-cell text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Paiement</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Produits</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Statut</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orderList.map(order => {
                  const isToday       = new Date(order.created_at).toDateString() === todayStr
                  const isInStorePend = order.payment_method === 'in_store' && order.payment_status === 'pending'

                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">

                      {/* N° */}
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/orders/${order.id}`}
                          className="font-mono text-xs font-semibold hover:underline"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          {order.id.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>

                      {/* Date */}
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          {formatDate(order.created_at, 'fr')}
                          {isToday && (
                            <span className="bg-yellow-50 text-yellow-700 text-xs font-medium px-2 py-0.5 rounded-full">
                              ⏰ Aujourd&apos;hui
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Client */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-gray-800 text-xs">
                            {order.full_name ?? order.email}
                          </span>
                          <span className="text-xs text-gray-400">{order.email}</span>
                          <DestinationCell
                            fulfillmentType={order.fulfillment_type}
                            shippingAddress={order.shipping_address}
                          />
                        </div>
                      </td>

                      {/* Payment */}
                      <td className="hidden md:table-cell px-4 py-3">
                        <PaymentBadge method={order.payment_method} />
                        {isInStorePend && (
                          <p className="text-xs text-gray-400 mt-0.5">En attente</p>
                        )}
                      </td>

                      {/* Products */}
                      <td className="px-4 py-3 max-w-xs">
                        <ProductsCell items={order.order_items ?? []} />
                      </td>

                      {/* Total */}
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">
                        {formatPrice(order.total, tenant.currency)}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 items-start">
                          <div className="flex items-center gap-1">
                            <StatusBadge status={order.status} />
                            {order.status === 'shipped' && (
                              <CopyTrackingButton
                                orderId={order.id}
                                email={order.email}
                                lang="fr"
                              />
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <Link
                            href={`/admin/orders/${order.id}/picking-list`}
                            title="Imprimer picking list"
                            className="text-gray-400 hover:text-gray-600 text-sm"
                          >
                            🖨
                          </Link>
                          <Link
                            href={`/admin/orders/${order.id}`}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors whitespace-nowrap"
                          >
                            Voir →
                          </Link>
                        </div>
                      </td>

                    </tr>
                  )
                })}

                {orderList.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                      Aucune commande pour ce filtre.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
