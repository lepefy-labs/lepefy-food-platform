import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBuildingStore,
  IconCheck,
  IconExternalLink,
  IconMail,
  IconMapPin,
  IconReceipt,
  IconSnowflake,
  IconTruck,
} from '@tabler/icons-react'
import { formatPrice, formatDate } from '@/lib/utils/format'
import OrderDetail, { type NextStepGuide } from '../../../orders/[id]/OrderDetail'
import PickingChecklist from '../../../orders/[id]/PickingChecklist'
import ShipmentTrackingCard from '../../../orders/[id]/ShipmentTrackingCard'
import StatusBadge from '../../../_components/ui/StatusBadge'
import AdminBlockAccent from '../../../_components/ui/AdminBlockAccent'
import ShareLinkActions from '../../../_components/ui/ShareLinkActions'
import type { Order, OrderItem, PaymentConfirmationSource } from '@lepefy/types'
import { SALES_CHANNEL_LABELS } from '@lepefy/types'
import { readShippingAutomationSettings } from '@/lib/shipping/shipmentDraft/settings'
import { buildOrderTrackingLink } from '@/lib/orders/convertCheckoutSessionToOrder'
import { buildTrackingShareMessage, preorderReference } from '@/lib/orders/assisted/assistedOrderPolicy'
import { shopBaseUrl } from '@/lib/orders/assisted/assistedOrderServer'
import { getShippingProvider, managedShippingProviderInfo } from '@/lib/shipping/providers/registry'
import { loadCartonSuggestion } from '@/lib/shipping/loadCartonSuggestion'
import { readOrderDocumentSettings } from '@/lib/orders/documents/settings'
import { carrierDisplayName, shipmentEventsNewestFirst } from '@/lib/shipping/shipmentPresentation'
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac'
import { dailyDigestModule, DAILY_DIGEST_DEFAULTS } from '@/lib/notifications/dailyDigestConfig'
import { readModuleConfig } from '@/lib/tenantConfig/moduleConfig'
import {
  classifyOrderOperation, formatSince, orderDetailTransition, PRIORITY_GROUP_LABELS, transportState,
  type OperationalOrder, type OrderActionSection, type OrderAnomalyCode,
} from '@/lib/orders/adminOrderOperations'

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
  if (method === 'external_link') return 'Paiement externe'
  if (method === 'manual') return 'Encaissement enregistré'
  if (method === 'satispay') return 'Satispay'
  if (method === 'in_store') return 'En magasin'
  if (method === 'cash') return 'Espèces'
  return method ?? '—'
}

const CONFIRMATION_SOURCE_LABELS: Record<PaymentConfirmationSource, string> = {
  stripe_webhook: 'Confirmé automatiquement par Stripe',
  admin_verified: 'Paiement déclaré, vérifié manuellement par l’équipe',
  admin_recorded: 'Encaissement enregistré manuellement par l’équipe',
}

const ANOMALY_HINTS: Record<OrderAnomalyCode, string> = {
  stock_conflict: 'Stock insuffisant pour au moins une ligne : ajustez la commande ou contactez le client.',
  carrier_incident: 'Consultez le suivi transporteur et contactez le client si nécessaire.',
  parcel_returned: 'Le colis revient à l’expéditeur : contactez le client pour convenir de la suite.',
  shipment_cancelled: 'L’expédition a été annulée côté transporteur : vérifiez-la dans le panneau d’expédition.',
  sync_error: 'Les dernières données connues sont conservées : relancez la synchronisation.',
  payment_unverified: 'Vérifiez le moyen de paiement avant le traitement final.',
  shipped_without_tracking: 'Renseignez le code de suivi pour que le client puisse suivre son colis.',
  tracking_stale: 'Aucun mouvement récent : vérifiez auprès du transporteur.',
  eta_overdue: 'La date de livraison estimée est dépassée : vérifiez auprès du transporteur.',
}

const SECTION_HINTS: Partial<Record<OrderActionSection, string>> = {
  preparation: 'Cochez chaque ligne prélevée et les contrôles froid dans la checklist.',
  packing: 'Validez le nombre réel de colis et l’emballage.',
  shipment: 'Associez ou synchronisez l’expédition dans le panneau transporteur.',
  tracking: 'Consultez le suivi transporteur, puis contactez le client si nécessaire.',
  payment: 'Vérifiez l’encaissement avant de poursuivre.',
}

const TRANSPORT_TONES = {
  danger: 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-200 dark:ring-red-900',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-900',
  neutral: 'bg-gray-50 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700',
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

  const [{ data: rawItems }, { data: carriersRaw }, access, digest, documentSettings, shipmentAutomation] = await Promise.all([
    (supabase as unknown as {
      from(t: 'order_items'): ReturnType<ReturnType<typeof createServiceClient>['from']>
    }).from('order_items')
      .select('*')
      .eq('order_id', order.id)
      .eq('tenant_id', tenant.id) as unknown as Promise<{ data: OrderItem[] | null }>,
    supabase
      .from('carriers')
      .select('name')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .order('position', { ascending: true }),
    getCurrentAdminAccessContext(tenant.id),
    readModuleConfig(supabase, dailyDigestModule, tenant.id).catch(() => null),
    readOrderDocumentSettings(supabase, tenant.id),
    readShippingAutomationSettings(supabase, tenant.id),
  ])

  const items = (rawItems ?? []).sort((a, b) => {
    const aLocation = a.warehouse_location ?? ''
    const bLocation = b.warehouse_location ?? ''
    if (!aLocation && !bLocation) return 0
    if (!aLocation) return 1
    if (!bLocation) return -1
    return aLocation.localeCompare(bLocation)
  })
  const carriers = (carriersRaw ?? []) as { name: string }[]
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))
  // Same tenant thresholds as the orders work queue and the daily digest.
  const digestConfig = digest?.status === 'ok' ? digest.config : DAILY_DIGEST_DEFAULTS
  const thresholds = { prepareHours: digestConfig.prepare_hours, pickupHours: digestConfig.pickup_hours, trackingStaleHours: digestConfig.tracking_stale_hours }

  // Commande assistée / encaissement manuel : origine, audit de l'encaissement
  // et lien de suivi à partager quand le client n'a pas d'e-mail.
  const isAssisted = order.order_origin === 'assisted'
  const showPaymentAudit = isAssisted || Boolean(order.payment_confirmation_source && order.payment_confirmation_source !== 'stripe_webhook')
  const [assistedSessionResult, confirmerResult] = await Promise.all([
    isAssisted && order.checkout_session_id
      ? supabase.from('checkout_sessions').select('id, phone').eq('id', order.checkout_session_id).eq('tenant_id', tenant.id).maybeSingle()
      : Promise.resolve({ data: null }),
    order.payment_confirmed_by
      ? supabase.from('admin_users').select('email').eq('id', order.payment_confirmed_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const assistedSession = assistedSessionResult.data as { id: string; phone: string | null } | null
  const confirmedByEmail = (confirmerResult.data as { email: string } | null)?.email ?? null
  const trackingLink = isAssisted ? buildOrderTrackingLink(order.id, order.email, shopBaseUrl(tenant)) : null
  const shippingDetails = (order.shipping_details ?? null) as ShippingDetails | null
  const isPickup = order.fulfillment_type === 'pickup'

  // Carton suggéré (aide à la préparation, jamais utilisé pour le prix).
  // Poids : celui calculé au checkout, sinon recalculé depuis les produits.
  const { suggestion: cartonSuggestion, missingWeightLines } = !isPickup && !['delivered', 'cancelled'].includes(order.status)
    ? await loadCartonSuggestion(supabase, tenant.id, items, shippingDetails?.totalWeightG)
    : { suggestion: null, missingWeightLines: 0 }
  const steps = isPickup ? PICKUP_STEPS : DELIVERY_STEPS
  const currentStep = steps.findIndex(step => step.key === order.status)
  const address = order.shipping_address as {
    line1?: string
    postal_code?: string
    city?: string
    country?: string
  } | null

  const frozenQty = items.filter(item => item.storage_type === 'frozen').reduce((sum, item) => sum + item.quantity, 0)
  const freshQty = items.filter(item => item.storage_type === 'fresh').reduce((sum, item) => sum + item.quantity, 0)
  const hasColdChain = frozenQty > 0 || freshQty > 0
  const pickedCount = items.filter(item => item.picked_at).length
  const coldItems = items.filter(item => item.storage_type === 'fresh' || item.storage_type === 'frozen')
  const coldChecked = coldItems.filter(item => item.cold_chain_checked_at).length
  const pickingComplete = items.length > 0 && pickedCount === items.length && coldChecked === coldItems.length
  const pickingProgress = { total: items.length, picked: pickedCount, coldRequired: coldItems.length, coldChecked, complete: pickingComplete }

  // Same classifier as the work queue: group, reliable anomaly, contextual urgency, next action.
  const now = new Date()
  const managedProvider = managedShippingProviderInfo(order.shipping_provider_key ?? tenant.shipping_provider)
  const managed = !isPickup && order.shipping_tracking_mode !== 'manual' && Boolean(managedProvider)
  const operation = classifyOrderOperation({ ...(order as unknown as OperationalOrder), managedProviderAvailable: Boolean(managedProvider) }, thresholds, now)
  const transition = orderDetailTransition(order, managed)
  const terminal = operation.group === 'finished'
  const transport = transportState(order)
  const trackingEvents = shipmentEventsNewestFirst(order.shipping_tracking_events)
  const showTracking = !isPickup && Boolean(order.shipping_provider_reference || order.tracking_code || trackingEvents.length > 0)
  // Brouillons d'expédition (migration 151) : réglage actif + transporteur du tenant capable de créer.
  const draftCreation = managed && shipmentAutomation.enabled
    && Boolean(getShippingProvider(tenant.shipping_provider)?.capabilities.createDraft)
  const showShipmentPanel = managed && (order.status !== 'new' || draftCreation) && order.status !== 'cancelled'
  const inStorePending = order.payment_method === 'in_store' && order.payment_status === 'pending'

  // Where the next action is carried out; null when that panel is not on the page.
  const sectionHref: Record<OrderActionSection, string | null> = {
    actions: canManage && transition ? '#order-actions-panel' : null,
    preparation: '#picking-checklist',
    packing: !isPickup && order.status === 'preparing' ? '#order-packing' : null,
    shipment: showShipmentPanel ? '#order-shipment' : showTracking ? '#order-tracking' : null,
    tracking: showTracking ? '#order-tracking' : showShipmentPanel ? '#order-shipment' : null,
    payment: inStorePending ? '#order-payment' : showPaymentAudit ? '#order-origin' : null,
    none: null,
  }
  const ctaHref = terminal ? null : sectionHref[operation.action.section]
  const showCta = Boolean(ctaHref) && (canManage || operation.action.intent === 'tracking')
  // Guidance only for a step the team must take; a plain consultation (normal transit) needs none.
  const nextStep: NextStepGuide | null = !terminal && !transition && operation.action.primary && ctaHref && SECTION_HINTS[operation.action.section]
    ? { label: operation.action.label, hint: SECTION_HINTS[operation.action.section]!, href: ctaHref }
    : null

  const alertTone = operation.anomaly && (operation.flags.has('incidents') || operation.anomaly.code === 'stock_conflict') ? 'danger' : 'warning'
  const pickingNeedsAttention = order.status === 'preparing' && !pickingComplete
  const mapQuery = address
    ? [address.line1, address.postal_code, address.city, address.country].filter(Boolean).join(', ')
    : ''
  const reference = `#${order.id.slice(0, 8).toUpperCase()}`

  return (
    <div className="mx-auto w-full max-w-7xl pb-10">
      <Link
        href="/admin"
        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-gray-500 transition hover:bg-[var(--admin-surface-subtle)] hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <IconArrowLeft size={17} aria-hidden="true" />
        Retour aux commandes
      </Link>

      <header className="mb-4 flex flex-col gap-4 rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight text-gray-950 dark:text-gray-100 sm:text-2xl">{reference}</h1>
            <StatusBadge status={order.status} fulfillmentType={order.fulfillment_type} />
            {transport && !terminal && <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TRANSPORT_TONES[transport.tone]}`}>Transport : {transport.label}</span>}
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {isPickup ? <IconBuildingStore size={13} aria-hidden="true" /> : <IconTruck size={13} aria-hidden="true" />}{isPickup ? 'Retrait magasin' : 'Livraison'}
            </span>
            {hasColdChain && !terminal && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                <IconSnowflake size={13} aria-hidden="true" /> Chaîne du froid
              </span>
            )}
            {order.status === 'preparing' && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${pickingComplete
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
              }`}>
                {pickingComplete && <IconCheck size={13} aria-hidden="true" />}
                Préparation {pickedCount}/{items.length}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {formatDate(order.created_at, 'fr')} · {order.full_name ?? order.email ?? 'Client'}
            {!terminal && <> · {formatSince(order.created_at, now)}</>}
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:justify-end lg:gap-5">
          {showCta && ctaHref && (
            <a href={ctaHref} className={`inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--admin-primary)] sm:w-auto ${operation.action.primary ? 'bg-[var(--admin-primary)] text-white hover:opacity-90' : 'border border-[var(--admin-border)] bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200'}`}>
              {operation.action.label}
            </a>
          )}
          <div className="text-left sm:text-right">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total</p>
            <p className="text-2xl font-semibold text-gray-950 dark:text-gray-100">{formatPrice(order.total, tenant.currency)}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {paymentLabel(order.payment_method)} · <span className={order.payment_status === 'paid' ? 'font-medium text-emerald-700 dark:text-emerald-300' : 'font-medium text-amber-700 dark:text-amber-300'}>{order.payment_status === 'paid' ? 'Payé' : 'Paiement en attente'}</span>
            </p>
          </div>
        </div>
      </header>

      {(operation.anomaly || operation.urgency || operation.notice || pickingNeedsAttention) && (
        <div className="mb-4 space-y-2">
          {operation.anomaly && (
            <p role="alert" className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${alertTone === 'danger' ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'}`}>
              <IconAlertTriangle size={15} aria-hidden="true" className="mt-px shrink-0" />
              <span><strong>{PRIORITY_GROUP_LABELS.action_required} · {operation.anomaly.label}.</strong> {ANOMALY_HINTS[operation.anomaly.code]}</span>
            </p>
          )}
          {operation.urgency && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <IconAlertTriangle size={15} aria-hidden="true" className="mt-px shrink-0" />
              <span><strong>{PRIORITY_GROUP_LABELS[operation.group]} · {operation.urgency}.</strong> Seuil configuré dans Paramètres → Automatisations.</span>
            </p>
          )}
          {operation.notice && (
            <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <IconAlertTriangle size={15} aria-hidden="true" className="mt-px shrink-0" />
              <span><strong>{operation.notice}.</strong> Les colis sont prêts : associez l’expédition {managedProvider?.displayName ?? 'transporteur'}.</span>
            </p>
          )}
          {pickingNeedsAttention && (
            <a href="#picking-checklist" className="block rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200 dark:hover:bg-amber-950/50">
              <strong>Préparation incomplète :</strong> {pickedCount}/{items.length} lignes prélevées{coldItems.length > 0 ? ` · froid ${coldChecked}/${coldItems.length}` : ''}.
            </a>
          )}
        </div>
      )}

      {order.status === 'cancelled' ? (
        <p className="mb-5 rounded-2xl border border-[var(--admin-border)] bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-gray-950/40 dark:text-gray-300">
          Commande annulée {formatSince(order.updated_at, now)}.
        </p>
      ) : (
        <section aria-labelledby="order-progress-title" className="mb-5 rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
          <h2 id="order-progress-title" className="sr-only">Avancement de la commande</h2>
          <ol className="grid grid-cols-4 gap-1">
            {steps.map((step, index) => {
              const complete = currentStep >= index
              return (
                <li key={step.key} className="relative text-center" aria-current={currentStep === index ? 'step' : undefined}>
                  <div className="relative mb-2 flex items-center justify-center">
                    {index > 0 && <span aria-hidden="true" className={`absolute right-1/2 h-0.5 w-full ${complete ? 'bg-[var(--admin-primary)]' : 'bg-gray-200 dark:bg-gray-700'}`} />}
                    <span aria-hidden="true" className={`relative z-10 h-3.5 w-3.5 rounded-full border-2 ${complete ? 'border-[var(--admin-primary)] bg-[var(--admin-primary)]' : 'border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900'}`} />
                  </div>
                  <span className={`text-[11px] font-medium sm:text-xs ${complete ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400'}`}>{step.label}</span>
                </li>
              )
            })}
          </ol>
          {order.status === 'stock_conflict' && <p className="mt-3 text-center text-xs font-medium text-red-700 dark:text-red-300">Workflow suspendu : conflit de stock.</p>}
          {order.status === 'shipped' && order.shipped_at && <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">Expédiée {formatSince(order.shipped_at, now)}</p>}
          {order.status === 'delivered' && <p className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">{isPickup ? 'Retirée' : 'Livrée'} · dernière mise à jour {formatSince(order.updated_at, now)}</p>}
        </section>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <div className="order-2 space-y-5 xl:order-1">
          {showTracking && (
            <ShipmentTrackingCard
              order={order}
              carrier={carrierDisplayName(order.tracking_carrier ?? shippingDetails?.carrierName)}
              service={shippingDetails?.serviceName ?? null}
              parcels={order.packing_parcel_count ?? shippingDetails?.numParcels ?? null}
              weight={shippingDetails?.totalWeightG ? `${(shippingDetails.totalWeightG / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg` : null}
              nowIso={now.toISOString()}
            />
          )}

          <div id="picking-checklist" className="scroll-mt-24">
            <AdminBlockAccent tone="primary">
              <PickingChecklist orderId={order.id} orderStatus={order.status} items={items} canManage={canManage} />
            </AdminBlockAccent>
          </div>

          <AdminBlockAccent tone="info">
            <section aria-labelledby="order-customer-title" className="rounded-2xl border border-[var(--admin-border)] bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
              <header className="flex items-center gap-3 border-b border-[var(--admin-border)] px-4 py-3.5 dark:border-gray-800">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                  <IconMail size={18} aria-hidden="true" />
                </span>
                <div>
                  <h2 id="order-customer-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">{isPickup ? 'Client & retrait' : 'Client & livraison'}</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Informations utiles au traitement</p>
                </div>
              </header>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <div className="rounded-xl bg-[var(--admin-surface-subtle)] p-3 dark:bg-gray-950/30">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{order.full_name ?? '—'}</p>
                  {order.email
                    ? <a href={`mailto:${order.email}`} className="mt-1 block break-all text-sm text-[var(--admin-primary-fg)] hover:underline">{order.email}</a>
                    : <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Pas d’e-mail{assistedSession?.phone ? ` · ${assistedSession.phone}` : ''}</p>}
                </div>
                <div className="rounded-xl bg-[var(--admin-surface-subtle)] p-3 dark:bg-gray-950/30">
                  <div className="flex items-start gap-2">
                    {isPickup ? <IconBuildingStore aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--admin-primary-fg)]" size={17} /> : <IconMapPin aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--admin-primary-fg)]" size={17} />}
                    <div className="min-w-0 text-sm text-gray-600 dark:text-gray-300">
                      <p className="font-medium text-gray-800 dark:text-gray-100">{isPickup ? 'Retrait magasin' : 'Livraison'}</p>
                      {!isPickup && address && (
                        <>
                          {address.line1 && <p className="mt-1">{address.line1}</p>}
                          <p>{[address.postal_code, address.city].filter(Boolean).join(' ')}{address.country ? `, ${address.country}` : ''}</p>
                          {mapQuery && (
                            <a
                              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline"
                            >
                              Ouvrir dans Maps <IconExternalLink size={12} aria-hidden="true" /><span className="sr-only"> (nouvel onglet)</span>
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </AdminBlockAccent>

          {showPaymentAudit && (
            <section id="order-origin" className="scroll-mt-24 rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5" aria-labelledby="order-origin-title">
              <h2 id="order-origin-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Origine & encaissement</h2>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">Origine</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">
                    {isAssisted ? `Saisie par l’équipe${order.sales_channel ? ` · ${SALES_CHANNEL_LABELS[order.sales_channel]}` : ''}` : 'Boutique en ligne'}
                  </dd>
                  {assistedSession && (
                    <Link href={`/admin/orders/precommandes/${assistedSession.id}`} className="mt-1 inline-flex min-h-8 items-center text-xs font-semibold text-[var(--admin-primary-fg)] hover:underline">
                      Précommande {preorderReference(assistedSession.id)} →
                    </Link>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-gray-500 dark:text-gray-400">Paiement</dt>
                  <dd className="font-medium text-gray-900 dark:text-gray-100">{order.external_payment_label ?? paymentLabel(order.payment_method)}</dd>
                  {order.payment_confirmation_source && <dd className="text-xs text-gray-500 dark:text-gray-400">{CONFIRMATION_SOURCE_LABELS[order.payment_confirmation_source]}</dd>}
                </div>
                {order.payment_received_at && (
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Reçu le</dt><dd className="text-gray-900 dark:text-gray-100">{formatDate(order.payment_received_at, 'fr')}</dd></div>
                )}
                {order.payment_reference && (
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Référence</dt><dd className="break-all font-mono text-gray-900 dark:text-gray-100">{order.payment_reference}</dd></div>
                )}
                {confirmedByEmail && (
                  <div><dt className="text-xs text-gray-500 dark:text-gray-400">Confirmé par</dt><dd className="break-all text-gray-900 dark:text-gray-100">{confirmedByEmail}</dd></div>
                )}
                {order.payment_note && (
                  <div className="sm:col-span-2"><dt className="text-xs text-gray-500 dark:text-gray-400">Note d’encaissement</dt><dd className="whitespace-pre-wrap text-gray-900 dark:text-gray-100">{order.payment_note}</dd></div>
                )}
              </dl>
              {trackingLink && (
                <div className="mt-4 border-t border-[var(--admin-border)] pt-4 dark:border-gray-800">
                  <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                    {order.email
                      ? 'Lien de suivi client (également envoyé par e-mail aux étapes clés).'
                      : 'Le client n’a pas d’e-mail : aucune notification e-mail n’est envoyée. Partagez-lui ce lien de suivi.'}
                  </p>
                  <ShareLinkActions
                    url={trackingLink}
                    phone={assistedSession?.phone ?? null}
                    message={buildTrackingShareMessage({ customerName: order.full_name, orderNumber: reference, url: trackingLink, tenantName: tenant.name })}
                    copyLabel="Copier le lien de suivi"
                  />
                </div>
              )}
            </section>
          )}

          <section aria-labelledby="order-summary-title" className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"><IconReceipt size={18} aria-hidden="true" /></span>
              <h2 id="order-summary-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">Récapitulatif</h2>
            </div>
            <div className="ml-auto max-w-sm space-y-2 text-sm">
              <div className="flex justify-between gap-4 text-gray-500 dark:text-gray-400"><span>Sous-total</span><span>{formatPrice(order.subtotal, tenant.currency)}</span></div>
              {!isPickup && <div className="flex justify-between gap-4 text-gray-500 dark:text-gray-400"><span>Livraison</span><span>{order.shipping_cost === 0 ? 'Gratuite' : formatPrice(order.shipping_cost, tenant.currency)}</span></div>}
              <div className="flex justify-between gap-4 border-t border-gray-100 pt-2 text-base font-semibold text-gray-950 dark:border-gray-800 dark:text-gray-100"><span>Total</span><span>{formatPrice(order.total, tenant.currency)}</span></div>
            </div>
          </section>
        </div>

        <aside id="order-actions" aria-label="Actions et logistique" className="order-1 space-y-4 xl:order-2 xl:sticky xl:top-24">
          <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
            <IconTruck size={15} aria-hidden="true" />
            Actions & logistique
          </div>
          <OrderDetail
            order={order}
            currency={tenant.currency}
            carriers={carriers}
            shippingDetails={shippingDetails}
            shippingProvider={tenant.shipping_provider ?? 'flat_rate'}
            managedProvider={managedProvider}
            draftCreation={draftCreation}
            coldChain={{ fresh: freshQty, frozen: frozenQty }}
            pickingProgress={pickingProgress}
            cartonSuggestion={cartonSuggestion}
            missingWeightLines={missingWeightLines}
            canManage={canManage}
            nextStep={nextStep}
            documents={{
              pickingFormat: documentSettings.config.picking_list_format,
              packingSlipEnabled: documentSettings.config.packing_slip_enabled,
              packingSlipFormat: documentSettings.config.packing_slip_format,
              packingSlipQrUnavailable: !documentSettings.available && documentSettings.config.packing_slip_show_qr,
            }}
          />
        </aside>
      </div>
    </div>
  )
}
