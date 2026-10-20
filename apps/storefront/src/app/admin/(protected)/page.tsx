import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  IconCash, IconCircleCheck, IconClipboardList, IconPlus, IconPrinter, IconTruckDelivery, type Icon,
} from '@tabler/icons-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac'
import { classifyOrderOperation, type OperationalOrder } from '@/lib/orders/adminOrderOperations'
import { loadOrderWorkQueue, type WorkQueueResult } from '@/lib/orders/loadOrderWorkQueue'
import { loadOrderOperationalContext, ORDER_LIST } from '@/lib/orders/orderListParams'
import { buildPriorityItems, buildQuickActions, describeRecentOrder, type KpiCounts, type QuickAction, type RecentOrderRow } from '@/lib/admin/todayDashboard'
import { formatDate, formatMoney, formatNumber, pluralize } from '@/lib/admin/format'
import { PREPARATION_MODE_LABELS } from '@/lib/orders/preparation/preparationPolicy'
import { cn } from '@/lib/utils/cn'
import { isMissingPreparationColumn, withoutPreparationColumns } from '@/lib/orders/preparation/compat'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import { ButtonLink } from '../_components/ui/Button'
import { TONE_SOLID_BG_CLASS } from '../_components/ui/Badge'
import InlineAlert from '../_components/ui/InlineAlert'
import { Panel } from '../_components/ui/Panel'
import { ErrorState } from '../_components/ui/States'
import TodayPrepareList, { type PrepareRow } from './TodayPrepareList'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const QUICK_ICONS: Record<QuickAction['key'], Icon> = {
  prepare: IconClipboardList, print: IconPrinter, ship: IconTruckDelivery, new_order: IconPlus, payments: IconCash,
}

/** Orders list query keys (ORDER_LIST): an old /admin?… link is an orders link. */
const ORDER_LIST_KEYS = [...Object.keys(ORDER_LIST.spec), 'page', 'size']

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Europe/Paris' }).format(now))
  return hour >= 18 || hour < 5 ? 'Bonsoir' : 'Bonjour'
}

/**
 * « Aujourd'hui » — operational home of the shop workspace. Answers what to do
 * now; the full orders cockpit lives at /admin/orders. One light read of the
 * active orders (the same work-queue classifier as Commandes), two head
 * counts for payments that are not orders yet, one 8-row recent query.
 * No provider call, no history scan.
 */
export default async function AdminTodayPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  // Back-compat: /admin?status=…, ?view=…, ?q=… (notifications, bookmarks) open the orders list.
  const legacy = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (!ORDER_LIST_KEYS.includes(key)) continue
    for (const entry of Array.isArray(value) ? value : [value]) if (entry !== undefined) legacy.append(key, entry)
  }
  if (legacy.toString()) redirect(`/admin/orders?${legacy.toString()}`)

  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  const supabase = createServiceClient()
  const now = new Date()
  const dayStart = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) + 'T00:00:00')
  const [access, operational] = await Promise.all([getCurrentAdminAccessContext(tenant.id), loadOrderOperationalContext(supabase, tenant)])
  const RECENT_COLUMNS = 'id, created_at, updated_at, status, payment_status, fulfillment_type, full_name, total, closure_type'
  const readRecent = (columns: string) => supabase.from('orders').select(columns).eq('tenant_id', tenant.id).order('updated_at', { ascending: false }).limit(8)
  // Before migration 161: same list without closure_type.
  const readRecentOrders = async () => {
    const first = await readRecent(RECENT_COLUMNS)
    return isMissingPreparationColumn(first.error) ? readRecent(withoutPreparationColumns(RECENT_COLUMNS)) : first
  }
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))

  const [queue, { count: pendingLinkPayments }, { count: preordersToVerify }, { data: recentRaw }, { count: todayCount }] = await Promise.all([
    loadOrderWorkQueue(supabase, tenant.id, {
      filters: { view: 'to_prepare', status: '', dateFrom: '', dateTo: '', fulfillment: '', payment: '', search: '' },
      sort: 'priority', page: 1, pageSize: 8, now, thresholds: operational.thresholds,
      managedProviderAvailable: operational.managedProviderAvailable, originCountry: tenant.country, tenantPreparationMode: operational.preparationMode,
    }).catch((error: unknown): WorkQueueResult | null => { console.error('[admin/today] work queue unavailable', error); return null }),
    supabase.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id)
      .eq('payment_method', 'external_link').eq('origin', 'storefront').in('status', ['open', 'expired', 'awaiting_verification']).is('order_id', null),
    supabase.from('checkout_sessions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).eq('origin', 'assisted').eq('status', 'awaiting_verification'),
    readRecentOrders(),
    supabase.from('orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', dayStart.toISOString()),
  ])

  const kpis: KpiCounts = queue?.kpis ?? {}
  const linkPayments = pendingLinkPayments ?? 0
  const preorders = preordersToVerify ?? 0
  const priorities = buildPriorityItems({ kpis, pendingLinkPayments: linkPayments, preordersToVerify: preorders })
  const paymentsToVerify = (kpis.payment_unverified ?? 0) + linkPayments + preorders
  const actions = buildQuickActions({ kpis, mode: operational.preparationMode, canManage, paymentsToVerify })
  const recent = ((recentRaw ?? []) as unknown as RecentOrderRow[]).map((row) => ({ row, entry: describeRecentOrder(row) }))
  const name = access?.nickname || access?.firstName || null
  const dateLabel = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(now)

  const prepareRows: PrepareRow[] = ((queue?.rows ?? []) as unknown as Array<Omit<OperationalOrder, 'order_items'> & {
    id: string; full_name: string | null; email: string | null; order_items: Array<{ quantity: number; storage_type: string | null; cold_chain_checked_at?: string | null }>
  }>).map((order) => {
    const operation = classifyOrderOperation({ ...order, originCountry: tenant.country, managedProviderAvailable: operational.managedProviderAvailable, tenantPreparationMode: operational.preparationMode }, operational.thresholds, now)
    return {
      id: order.id,
      ref: `#${order.id.slice(0, 8).toUpperCase()}`,
      customer: order.full_name ?? order.email ?? 'Client',
      createdAt: formatDate(order.created_at, 'datetime'),
      units: order.order_items.reduce((sum, item) => sum + item.quantity, 0),
      lines: order.order_items.length,
      pickup: order.fulfillment_type === 'pickup',
      country: order.fulfillment_type === 'delivery' ? order.shipping_address?.country ?? null : null,
      international: operation.handling.international,
      fresh: operation.handling.fresh,
      frozen: operation.handling.frozen,
      step: operation.step,
      urgency: operation.urgency,
      action: operation.action.label,
    }
  })

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-10">
      <AdminPageHeader
        title={`${greeting(now)}${name ? ` ${name}` : ''}`}
        meta={<span className="capitalize">{dateLabel}</span>}
        description={`${tenant.name} · ${todayCount ? `${pluralize(todayCount, 'nouvelle commande', 'nouvelles commandes')} aujourd’hui` : 'aucune nouvelle commande aujourd’hui'}`}
        actions={<>
          <ButtonLink href="/admin/orders">Toutes les commandes</ButtonLink>
          {canManage && <ButtonLink href="/admin/orders/new" variant="primary"><IconPlus size={17} aria-hidden="true" /> Nouvelle commande</ButtonLink>}
        </>}
      />

      {!queue && <InlineAlert tone="warning" action={<Link href="/admin" className="underline">Réessayer</Link>}>Certains compteurs sont indisponibles. Les commandes restent accessibles dans Commandes.</InlineAlert>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Panel id="today-priorities" title="À régler en priorité" flush
          description={priorities.length ? pluralize(priorities.reduce((sum, item) => sum + item.count, 0), 'point à traiter', 'points à traiter') : undefined}>
          {priorities.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-4 text-sm text-tone-success-fg">
              <IconCircleCheck size={18} aria-hidden="true" /> Rien d’urgent : aucun paiement, stock ou incident à régler.
            </p>
          ) : (
            <ul className="divide-y divide-a-border">
              {priorities.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} className="grid min-h-14 grid-cols-[4px_minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-2.5 hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
                    <span aria-hidden="true" className={cn('h-full min-h-8 rounded-full', TONE_SOLID_BG_CLASS[item.tone])} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-a-text">{item.label}</span>
                      <span className="block text-xs text-a-text-3">{item.detail}</span>
                    </span>
                    <b className="text-lg font-bold tabular-nums text-a-text">{formatNumber(item.count)}</b>
                    <span className="text-sm font-semibold text-a-brand-fg">{item.cta}<span className="sr-only"> — {item.label}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel id="today-activity" title="Dernières mises à jour" flush>
          {recent.length === 0 ? <p className="px-4 py-4 text-sm text-a-text-3">Aucune commande pour le moment.</p> : (
            <ol className="divide-y divide-a-border">
              {recent.map(({ row, entry }) => (
                <li key={row.id}>
                  <Link href={`/admin/orders/${row.id}`} className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus">
                    <time dateTime={entry.at} className="w-12 shrink-0 text-xs tabular-nums text-a-text-3">{formatDate(entry.at, 'time')}</time>
                    <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', TONE_SOLID_BG_CLASS[entry.tone])} />
                    <span className="min-w-0 flex-1 truncate">{entry.label} <span className="font-mono text-xs text-a-text-2">#{row.id.slice(0, 8).toUpperCase()}</span><span className="text-a-text-3"> · {row.full_name ?? 'Client'}</span></span>
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-a-text-2">{formatMoney(Number(row.total ?? 0), tenant.currency || 'EUR')}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>

      <section aria-labelledby="today-actions-title">
        <h2 id="today-actions-title" className="mb-2 text-base font-semibold text-a-text">Que voulez-vous faire ?</h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {actions.map((action) => {
            const ActionIcon = QUICK_ICONS[action.key]
            return (
              <li key={action.key}>
                <Link href={action.href} className={cn('flex h-full min-h-24 flex-col gap-1 rounded-[10px] border bg-a-surface p-3 hover:bg-a-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-a-focus',
                  action.primary ? 'border-a-brand ring-1 ring-inset ring-a-brand' : 'border-a-border')}>
                  <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', action.primary ? 'bg-a-brand text-a-on-brand' : 'bg-a-brand-soft text-a-brand-fg')}>
                    <ActionIcon size={18} aria-hidden="true" />
                  </span>
                  <span className="text-sm font-semibold text-a-text">{action.label}</span>
                  <span className="text-xs text-a-text-3">{action.detail}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <Panel id="today-prepare" title={`Commandes à préparer${queue ? ` · ${formatNumber(queue.total)}` : ''}`} flush
        description={`Préparation : ${PREPARATION_MODE_LABELS[operational.preparationMode.picking].toLowerCase()} · ordre de priorité opérationnelle`}
        actions={<ButtonLink href="/admin/orders?view=to_prepare" size="sm">Tout voir</ButtonLink>}>
        {!queue
          ? <ErrorState title="Impossible de charger les commandes à préparer." action={<ButtonLink href="/admin">Réessayer</ButtonLink>} />
          : <TodayPrepareList rows={prepareRows} total={queue.total} />}
      </Panel>
    </div>
  )
}
