import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  IconArrowLeft,
  IconBuildingStore,
  IconMail,
  IconMapPin,
  IconPackage,
  IconReceipt,
  IconTruck,
} from '@tabler/icons-react'
import { formatPrice, formatDate } from '@/lib/utils/format'
import OrderDetail from '../../../orders/[id]/OrderDetail'
import PickingList from '../../../orders/[id]/PickingList'
import StatusBadge from '../../../_components/ui/StatusBadge'
import AdminBlockAccent from '../../../_components/ui/AdminBlockAccent'
import type { Order, OrderItem } from '@lepefy/types'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface PageProps {
  params: { id: string }
}

interface ShippingDetails {
  totalWeightG?: number
  numParcels?: number
  packlinkCost?: number
  serviceId?: number
  serviceName?: string
  carrierName?: string
  vatSource?: 'packlink' | 'db'
  vatRate?: number
  vatAmount?: number
  surchargeMode?: string
  packagingSurchargeTotal?: number
  boxDimensions?: { length: number; width: number; height: number }
  countryRuleApplied?: boolean
  originalShippingCost?: number
  discountApplied?: number
  freeShippingApplied?: boolean
}

const DELIVERY_STEPS = [
  { key: 'new', label: 'Nouvelle' },
  { key: 'preparing', label: 'Préparation' },
  { key: 'shipped', label: 'Expédiée' },
  { key: 'delivered', label: 'Livrée' },
] as const

const PICKUP_STEPS = [
  { key: 'new', label: 'Nouvelle' },
  { key: 'preparing', label: 'Préparation' },
  { key: 'ready_for_pickup', label: 'Prête' },
  { key: 'delivered', label: 'Retirée' },
] as const

function paymentLabel(method: string | null) {
  if (method === 'stripe') return 'Carte bancaire'
  if (method === 'satispay') return 'Satispay'
  if (method === 'in_store') return 'En magasin'
  if (method === 'cash') return 'Espèces'
  return method ?? '—'
}

export default async function AdminOrderPage({ params }: PageProps) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood'
  const tenant = await getTenant(tenantSlug)
  const supabase = createServiceClient()

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle() as { data: Order | null }

  if (!order) notFound()

  const { data: rawItems } = await (supabase as unknown as {
    from(t: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>
  }).from('order_items')
    .select('*')
    .eq('order_id', order.id) as { data: OrderItem[] | null }

  const items = (rawItems ?? []).sort((a, b) => {
    const aLocation = a.warehouse_location ?? ''
    const bLocation = b.warehouse_location ?? ''
    if (!aLocation && !bLocation) return 0
    if (!aLocation) return 1
    if (!bLocation) return -1
    return aLocation.localeCompare(bLocation)
  })

  const { data: carriersRaw } = await supabase
    .from('carriers')
    .select('name')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .order('position', { ascending: true })

  const carriers = (carriersRaw ?? []) as { name: string }[]
  const shippingDetails = (order.shipping_details ?? null) as ShippingDetails | null
  const isPickup = order.fulfillment_type === 'pickup'
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS
  const currentStep = steps.findIndex(step => step.key === order.status)
  const address = order.shipping_address as {
    line1?: string
    postal_code?: string
    city?: string
    country?: string
  } | null

  return (
    <>
      <div className="no-print mx-auto w-full max-w-7xl pb-10">
        <Link
          href="/admin"
          className="mb-4 inline-flex min-h-10 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 transition hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <IconArrowLeft size={17} />
          Retour aux commandes
        </Link>

        <header className="mb-5 flex flex-col gap-4 rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-semibold tracking-tight text-gray-950 dark:text-gray-100 sm:text-2xl">
                #{order.id.slice(0, 8).toUpperCase()}
              </h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(order.created_at, 'fr')} · {order.full_name ?? order.email}
            </p>
          </div>
          <div className="flex items-end justify-between gap-4 lg:flex-col lg:items-end">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total</p>
              <p className="text-2xl font-semibold text-gray-950 dark:text-gray-100">{formatPrice(order.total, tenant.currency)}</p>
            </div>
            <div className="text-right text-xs text-gray-500 dark:text-gray-400">
              <p>{paymentLabel(order.payment_method)}</p>
              <p className={order.payment_status === 'paid' ? 'font-medium text-emerald-600' : 'font-medium text-amber-600'}>
                {order.payment_status === 'paid' ? 'Payé' : 'Paiement en attente'}
              </p>
            </div>
          </div>
        </header>

        {order.status !== 'cancelled' && (
          <section className="mb-5 rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Avancement de la commande</h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Le statut actuel reste modifiable dans le panneau d&apos;actions.</p>
              </div>
              <StatusBadge status={order.status} />
            </div>
            <ol className="grid grid-cols-4 gap-1" aria-label="Avancement de la commande">
              {steps.map((step, index) => {
                const complete = currentStep >= index
                return (
                  <li key={step.key} className="relative text-center">
                    <div className="relative mb-2 flex items-center justify-center">
                      {index > 0 && (
                        <span className={`absolute right-1/2 h-0.5 w-full ${complete ? 'bg-[var(--admin-primary)]' : 'bg-gray-200 dark:bg-gray-700'}`} />
                      )}
                      <span className={`relative z-10 h-3.5 w-3.5 rounded-full border-2 ${complete ? 'border-[var(--admin-primary)] bg-[var(--admin-primary)]' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'}`} />
                    </div>
                    <span className={`text-[11px] font-medium sm:text-xs ${complete ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400'}`}>{step.label}</span>
                  </li>
                )
              })}
            </ol>
          </section>
        )}

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
          <div className="space-y-5">
            <AdminBlockAccent tone="info">
              <section className="rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <header className="flex items-center gap-3 border-b border-[var(--admin-border)] px-4 py-3.5 dark:border-gray-800">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                    <IconMail size={18} />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Client</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Coordonnées associées à cette commande</p>
                  </div>
                </header>
                <div className="grid gap-4 p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{order.full_name ?? '—'}</p>
                    <p className="mt-1 break-all text-sm text-gray-500 dark:text-gray-400">{order.email}</p>
                  </div>
                  <div className="rounded-xl bg-[var(--admin-surface-subtle)] p-3 dark:bg-gray-950/30">
                    <div className="flex items-start gap-2">
                      {isPickup ? <IconBuildingStore className="mt-0.5 shrink-0 text-[var(--admin-primary-fg)]" size={17} /> : <IconMapPin className="mt-0.5 shrink-0 text-[var(--admin-primary-fg)]" size={17} />}
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        <p className="font-medium text-gray-800 dark:text-gray-100">{isPickup ? 'Click & Collect' : 'Livraison'}</p>
                        {!isPickup && address && (
                          <>
                            {address.line1 && <p className="mt-1">{address.line1}</p>}
                            <p>{[address.postal_code, address.city].filter(Boolean).join(' ')}{address.country ? `, ${address.country}` : ''}</p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
            </AdminBlockAccent>

            <AdminBlockAccent tone="primary">
              <section className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
                <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-border)] px-4 py-3.5 dark:border-gray-800">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]">
                      <IconPackage size={18} />
                    </span>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Produits commandés</h2>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{items.length} ligne{items.length !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                </header>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map(item => (
                    <div key={item.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>Quantité {item.quantity}</span>
                          {item.warehouse_location && <span>· Emplacement {item.warehouse_location}</span>}
                          {item.storage_type === 'frozen' && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-950 dark:text-blue-300">❄ Surgelé</span>}
                          {item.storage_type === 'fresh' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">🌿 Frais</span>}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-gray-900 dark:text-gray-100">{formatPrice(item.subtotal, tenant.currency)}</span>
                    </div>
                  ))}
                </div>
              </section>
            </AdminBlockAccent>

            <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><IconReceipt size={18} /></span>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Récapitulatif</h2>
              </div>
              <div className="ml-auto max-w-sm space-y-2 text-sm">
                <div className="flex justify-between gap-4 text-gray-500 dark:text-gray-400"><span>Sous-total</span><span>{formatPrice(order.subtotal, tenant.currency)}</span></div>
                {!isPickup && <div className="flex justify-between gap-4 text-gray-500 dark:text-gray-400"><span>Livraison</span><span>{order.shipping_cost === 0 ? 'Gratuite' : formatPrice(order.shipping_cost, tenant.currency)}</span></div>}
                <div className="flex justify-between gap-4 border-t border-gray-100 pt-2 text-base font-semibold text-gray-950 dark:border-gray-800 dark:text-gray-100"><span>Total</span><span>{formatPrice(order.total, tenant.currency)}</span></div>
              </div>
            </section>
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24">
            <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
              <IconTruck size={15} />
              Actions & logistique
            </div>
            <OrderDetail
              order={order}
              currency={tenant.currency}
              carriers={carriers}
              shippingDetails={shippingDetails}
              shippingProvider={tenant.shipping_provider ?? 'flat_rate'}
            />
          </aside>
        </div>
      </div>

      <PickingList order={order} items={items} currency={tenant.currency} />
    </>
  )
}
