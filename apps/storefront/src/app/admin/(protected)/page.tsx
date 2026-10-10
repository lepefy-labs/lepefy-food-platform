import Link from 'next/link'
import { Suspense } from 'react'
import { IconClipboardList, IconDownload, IconPlus, IconSnowflake } from '@tabler/icons-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac'
import { ORDER_SORT_OPTIONS, type QueueKey } from '@/lib/orders/adminOrderOperations'
import { loadOrderWorkQueue, type OrderView, type WorkQueueResult } from '@/lib/orders/loadOrderWorkQueue'
import { loadOrderOperationalContext, ORDER_LIST, parseOrderList, type OrderListValues } from '@/lib/orders/orderListParams'
import { pageWindow } from '@/lib/admin/listParams'
import { formatNumber, pluralize } from '@/lib/admin/format'
import { ORDER_STATUS_META } from '@/lib/admin/statusRegistry'
import type { AdminTone } from '@/lib/admin/tokens'
import { cn } from '@/lib/utils/cn'
import { readOrderDocumentSettings } from '@/lib/orders/documents/settings'
import OrdersTable, { type ListOrder } from './OrdersTable'
import PendingPaymentsBanner, { type PendingPaymentSession } from './PendingPaymentsBanner'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import AdminStatCard from '../_components/ui/AdminStatCard'
import { CountBadge, TONE_BADGE_CLASS } from '../_components/ui/Badge'
import { ButtonAnchor, ButtonLink } from '../_components/ui/Button'
import InlineAlert from '../_components/ui/InlineAlert'
import { Card } from '../_components/ui/Panel'
import { ErrorState } from '../_components/ui/States'
import FilterBar, { type ActiveFilterChip, type FilterView } from '../_components/data/FilterBar'
import Pagination from '../_components/data/Pagination'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const PAYMENT_LABELS: Record<string, string> = {
  stripe: 'Carte bancaire', satispay: 'Satispay', in_store: 'En magasin', external_link: 'Lien de paiement', cash: 'Espèces', manual: 'Manuel',
}

const OPERATIONAL_VIEWS: { key: Exclude<OrderView, ''> & QueueKey; label: string; helper: string; tone: AdminTone }[] = [
  { key: 'to_treat', label: 'À traiter', helper: 'Une action de l’équipe est attendue', tone: 'info' },
  { key: 'preparing', label: 'En préparation', helper: 'Préparation et emballage', tone: 'warning' },
  { key: 'to_ship', label: 'À expédier', helper: 'Colis prêts à partir', tone: 'warning' },
  { key: 'in_transit', label: 'En transit', helper: 'Confirmé par le transporteur', tone: 'info' },
  { key: 'incidents', label: 'Incidents', helper: 'Signalés par le transporteur', tone: 'danger' },
  { key: 'pickup_ready', label: 'Retraits prêts', helper: 'Client attendu en boutique', tone: 'success' },
]

const VIEW_LABELS: Partial<Record<OrderView, string>> = {
  to_treat: 'À traiter', preparing: 'En préparation', to_ship: 'À expédier', in_transit: 'En transit', incidents: 'Incidents',
  pickup_ready: 'Retraits prêts', urgent: 'Urgents', finished: 'Terminés', payment_pending: 'Paiement à vérifier', aged: 'Plus de 24 h',
  picking_incomplete: 'Préparation incomplète', packing_pending: 'Emballage à terminer', tracking_missing: 'Suivi manquant',
}

export default async function AdminPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  const supabase = createServiceClient()
  const { values, filters, sort } = parseOrderList(searchParams)
  const [access, operational, documentSettings] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    loadOrderOperationalContext(supabase, tenant),
    readOrderDocumentSettings(supabase, tenant.id),
  ])
  const documentDefaults = {
    pickingFormat: documentSettings.config.picking_list_format,
    packingSlipEnabled: documentSettings.config.packing_slip_enabled,
    packingSlipFormat: documentSettings.config.packing_slip_format,
    packingSlipQrUnavailable: !documentSettings.available && documentSettings.config.packing_slip_show_qr,
  }
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))
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
    supabase.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('origin', 'assisted').in('status', ['draft', 'open', 'awaiting_verification']),
    supabase.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('origin', 'assisted').eq('status', 'awaiting_verification'),
    loadOrderWorkQueue(supabase, tenant.id, { filters, sort, page: values.page, pageSize: values.pageSize, thresholds: operational.thresholds, now, managedProviderAvailable: operational.managedProviderAvailable, originCountry: tenant.country })
      .catch((error: unknown): WorkQueueResult | null => { console.error('[admin/orders] work queue unavailable', error); return null }),
  ])
  const carriers = ((carriersRaw ?? []) as { name: string }[]).map(carrier => carrier.name)
  const pendingPayments = (pendingPaymentsRaw ?? []) as PendingPaymentSession[]

  const href = (patch: Partial<Record<keyof OrderListValues, unknown>>) => ORDER_LIST.href('/admin', values, patch)
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
  const window = pageWindow(queue?.total ?? 0, queue?.currentPage ?? 1, values.pageSize)
  const view = filters.view
  const hasFilters = ORDER_LIST.activeCount(values, ['view', 'status', 'fulfillment', 'payment', 'dateFrom', 'dateTo']) > 0 || Boolean(filters.search)
  // A search or a status filter often targets a closed order: show it. Livraison / Retrait / Urgents stay work queues.
  const finishedCollapsed = !filters.search && !values.status && view !== 'finished'
  // Reset keeps the chosen sort and page size: they are preferences, not filters.
  const resetHref = ORDER_LIST.href('/admin', { ...ORDER_LIST.parse({}), sort: values.sort, pageSize: values.pageSize }, {})

  // Quick views: fulfillment and a few queue views; KPI cards cover the rest.
  const views: FilterView[] = [
    { key: 'all', label: 'Tous', active: !view && !filters.fulfillment, href: href({ view: undefined, fulfillment: undefined }) },
    { key: 'delivery', label: 'Livraison', active: filters.fulfillment === 'delivery', href: href({ fulfillment: filters.fulfillment === 'delivery' ? undefined : 'delivery' }) },
    { key: 'pickup', label: 'Retrait', active: filters.fulfillment === 'pickup', href: href({ fulfillment: filters.fulfillment === 'pickup' ? undefined : 'pickup' }) },
    { key: 'urgent', label: 'Urgents', count: kpi('urgent'), countTone: 'urgent', active: view === 'urgent', href: href({ view: view === 'urgent' ? undefined : 'urgent', status: undefined }) },
    { key: 'incidents', label: 'Incidents', count: kpi('incidents'), countTone: 'danger', active: view === 'incidents', href: href({ view: view === 'incidents' ? undefined : 'incidents', status: undefined }) },
    { key: 'finished', label: 'Terminés', active: view === 'finished', href: href({ view: view === 'finished' ? undefined : 'finished', status: undefined }) },
  ]
  const chips: ActiveFilterChip[] = [
    ...(view && !['urgent', 'incidents', 'finished'].includes(view) ? [{ key: 'view', label: VIEW_LABELS[view] ?? view, href: href({ view: undefined }) }] : []),
    ...(filters.status ? [{ key: 'status', label: `Statut : ${ORDER_STATUS_META[filters.status]?.label ?? filters.status}`, href: href({ status: undefined }) }] : []),
    ...(filters.payment ? [{ key: 'payment', label: `Paiement : ${PAYMENT_LABELS[filters.payment] ?? filters.payment}`, href: href({ payment: undefined }) }] : []),
    ...(filters.dateFrom ? [{ key: 'dateFrom', label: `Depuis le ${filters.dateFrom.split('-').reverse().join('/')}`, href: href({ dateFrom: undefined }) }] : []),
    ...(filters.dateTo ? [{ key: 'dateTo', label: `Jusqu’au ${filters.dateTo.split('-').reverse().join('/')}`, href: href({ dateTo: undefined }) }] : []),
  ]
  const controls: { view: OrderView | null; label: string; count: number; tone: AdminTone; icon?: boolean }[] = [
    { view: 'picking_incomplete', label: 'Préparation incomplète', count: Number(stats?.picking_incomplete_count ?? 0), tone: 'warning' },
    { view: 'packing_pending', label: 'Emballage à terminer', count: Number(stats?.packing_pending_count ?? 0), tone: 'warning' },
    { view: 'tracking_missing', label: 'Suivi manquant', count: Number(stats?.tracking_missing_count ?? 0), tone: 'warning' },
    { view: null, label: 'Chaîne du froid', count: Number(stats?.cold_chain_action_count ?? 0), tone: 'urgent', icon: true },
    { view: 'payment_pending', label: 'Paiement à vérifier', count: Number(stats?.pending_payment_count ?? 0), tone: 'warning' },
  ]
  const exportQuery = ORDER_LIST.query({ ...values, page: 1, pageSize: ORDER_LIST.defaultPageSize })

  return (
    <div className="mx-auto w-full max-w-7xl">
      <AdminPageHeader
        title="Commandes"
        meta={pluralize(totalCount, 'commande')}
        description="Traitez d’abord les commandes qui demandent votre attention."
        actions={<>
          <ButtonLink href="/admin/orders/precommandes">
            <IconClipboardList size={17} aria-hidden="true" /> Précommandes
            <CountBadge tone="warning" count={activePreordersCount ?? 0} label={`${activePreordersCount ?? 0} précommandes actives`} />
          </ButtonLink>
          <ButtonAnchor href={`/api/admin/orders/export${exportQuery ? `?${exportQuery}` : ''}`} variant="secondary" title="Exporter la liste filtrée (CSV, 2 000 commandes max.)">
            <IconDownload size={17} aria-hidden="true" /> Exporter
          </ButtonAnchor>
          {canManage && <ButtonLink href="/admin/orders/new" variant="primary"><IconPlus size={17} aria-hidden="true" /> Nouvelle commande</ButtonLink>}
        </>}
      />

      <div className="space-y-3">
        {countsUnavailable && <InlineAlert tone="warning" action={<Link href="/admin" className="underline">Réessayer</Link>}>Certains compteurs sont indisponibles.</InlineAlert>}
        {queue && !queue.priorityAvailable && <InlineAlert tone="info">Plus de 5 000 commandes actives : la liste est triée par date et les compteurs sont partiels.</InlineAlert>}

        <section aria-labelledby="work-queue-title">
          <h2 id="work-queue-title" className="sr-only">File de fulfillment</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {OPERATIONAL_VIEWS.map(item => {
              const active = view === item.key
              return (
                <AdminStatCard
                  key={item.key}
                  href={href({ view: active ? undefined : item.key, status: undefined })}
                  title={item.label}
                  value={formatNumber(kpi(item.key))}
                  description={item.helper}
                  active={active}
                  tone={item.tone}
                />
              )
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-a-text-3">
            <span className="mr-0.5">Contrôles</span>
            {controls.map(control => {
              const className = cn('inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
                control.count > 0 ? TONE_BADGE_CLASS[control.tone] : 'border-a-border bg-a-surface text-a-text-3')
              const content = <>{control.icon && <IconSnowflake size={13} aria-hidden="true" />}{control.label} <b className="font-semibold tabular-nums">{control.count}</b></>
              return control.view && control.count > 0
                ? <Link key={control.label} href={href({ view: view === control.view ? undefined : control.view, status: undefined })} aria-current={view === control.view ? 'true' : undefined} className={cn(className, 'hover:underline', view === control.view && 'ring-1 ring-a-brand')}>{content}</Link>
                : <span key={control.label} className={className}>{content}</span>
            })}
          </div>
        </section>

        {pendingPayments.length > 0 && <PendingPaymentsBanner sessions={pendingPayments} tenantCurrency={tenant.currency} />}
        {(preordersToVerifyCount ?? 0) > 0 && (
          <InlineAlert tone="warning" action={<Link href="/admin/orders/precommandes" className="underline">Vérifier</Link>}>
            {pluralize(preordersToVerifyCount ?? 0, 'précommande')} avec un paiement à vérifier.
          </InlineAlert>
        )}

        <Card as="section" className="overflow-hidden">
          <h2 className="sr-only">Liste des commandes</h2>
          <Suspense fallback={<div className="h-14 border-b border-a-border" />}>
            <FilterBar
              views={views}
              viewsLabel="Filtres rapides"
              search={{ label: 'Rechercher une commande', placeholder: 'Client, e-mail, n° ou UUID de commande' }}
              filters={[
                { type: 'select', key: 'status', label: 'Statut', allLabel: 'Tous les statuts', options: Object.entries(ORDER_STATUS_META).map(([key, meta]) => ({ value: key, label: statusCounts[key] ? `${meta.label} (${formatNumber(statusCounts[key]!)})` : meta.label })) },
                { type: 'select', key: 'payment', label: 'Paiement', allLabel: 'Tous les paiements', options: Object.entries(PAYMENT_LABELS).filter(([key]) => key !== 'manual').map(([value, label]) => ({ value, label })) },
                { type: 'date-range', label: 'Date de commande', fromKey: 'dateFrom', toKey: 'dateTo' },
              ]}
              activeChips={chips}
              resetHref={resetHref}
              panelClears={['view']}
              sort={{ value: queue?.appliedSort ?? sort, options: ORDER_SORT_OPTIONS.map(option => ({ value: option.key, label: option.label })) }}
              resultLabel={pluralize(window.total, 'résultat')}
            />
          </Suspense>
          {!queue
            ? <ErrorState title="Impossible de charger les commandes." description="La file de travail n’a pas répondu. Les commandes ne sont pas perdues." action={<ButtonLink href={href({ page: window.page })}>Réessayer</ButtonLink>} />
            : <OrdersTable orders={orderList} tenantCurrency={tenant.currency} carriers={carriers} thresholds={operational.thresholds} canManage={canManage} managedProviderAvailable={operational.managedProviderAvailable} nowIso={now.toISOString()} originCountry={tenant.country} sort={queue.appliedSort} documentDefaults={documentDefaults} resetHref={resetHref} hasFilters={hasFilters} finishedCollapsed={finishedCollapsed} />}
          {queue && window.total > 0 && (
            <Pagination
              window={window}
              noun="commandes"
              hrefForPage={(page) => href({ page })}
              hrefForPageSize={(pageSize) => href({ pageSize })}
              pageSizes={ORDER_LIST.pageSizes}
            />
          )}
        </Card>
      </div>
    </div>
  )
}
