import Link from 'next/link'
import { IconAlertTriangle, IconCheck, IconLeaf, IconSnowflake, IconX } from '@tabler/icons-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { getCurrentAdminAccessContext, canAdmin } from '@/lib/auth/adminRbac'
import { classifyOrderOperation, type OperationalOrder } from '@/lib/orders/adminOrderOperations'
import { loadOrderWorkQueue } from '@/lib/orders/loadOrderWorkQueue'
import { loadOrderOperationalContext } from '@/lib/orders/orderListParams'
import { loadOrderDocumentData } from '@/lib/orders/documents/loadOrderDocumentData'
import { loadCatalogueFacts, parseOrderIdList } from '@/lib/orders/documents/renderOrderDocuments'
import { MAX_BULK_ORDER_DOCUMENTS } from '@/lib/orders/documents/formats'
import { readOrderDocumentSettings } from '@/lib/orders/documents/settings'
import { buildPreparationSummary, type SummaryStorage } from '@/lib/orders/preparation/preparationSummary'
import { orderPreparationMode, PREPARATION_MODE_LABELS, type PreparationOrder } from '@/lib/orders/preparation/preparationPolicy'
import { formatDate, formatNumber, pluralize } from '@/lib/admin/format'
import { isMissingPreparationColumn, withoutPreparationColumns } from '@/lib/orders/preparation/compat'
import { cn } from '@/lib/utils/cn'
import AdminPageHeader from '../../../_components/ui/AdminPageHeader'
import Badge from '../../../_components/ui/Badge'
import InlineAlert from '../../../_components/ui/InlineAlert'
import { Panel } from '../../../_components/ui/Panel'
import { EmptyState } from '../../../_components/ui/States'
import TodayPrepareList, { type PrepareRow } from '../../TodayPrepareList'
import PreparationSessionActions from './PreparationSessionActions'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface SessionOrderRow extends PreparationOrder {
  id: string
  status: string
  payment_status: string
  full_name: string | null
}

const SESSION_COLUMNS = 'id, status, payment_status, fulfillment_type, full_name, preparation_mode, picking_list_printed_at, paper_preparation_started_at, paper_preparation_completed_at'

const EXCLUSION: Record<string, string> = {
  payment: 'paiement à vérifier',
  stock_conflict: 'conflit de stock',
  closed: 'déjà expédiée, retirée ou annulée',
}

const GROUP_ICON: Partial<Record<SummaryStorage, typeof IconLeaf>> = { fresh: IconLeaf, frozen: IconSnowflake }

/**
 * Session de préparation (stateless): the selection lives in `?ids=`. Shows
 * one line per article with its total and its split by order (dry → fresh →
 * frozen), the orders set aside and why, and offers the printed documents.
 * Without ids it lists the orders to prepare so the team can pick some.
 */
export default async function PreparationSessionPage({ searchParams }: { searchParams: { ids?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  const db = createServiceClient()
  const now = new Date()
  const [access, operational, documentSettings] = await Promise.all([
    getCurrentAdminAccessContext(tenant.id),
    loadOrderOperationalContext(db, tenant),
    readOrderDocumentSettings(db, tenant.id),
  ])
  const canManage = Boolean(access && canAdmin(access, 'orders.manage'))
  const requested = parseOrderIdList(searchParams.ids)
  const ids = requested.slice(0, MAX_BULK_ORDER_DOCUMENTS)
  const breadcrumb = [{ label: 'Commandes', href: '/admin/orders' }, { label: 'Session de préparation' }]

  if (ids.length === 0) {
    const queue = await loadOrderWorkQueue(db, tenant.id, {
      filters: { view: 'to_prepare', status: '', dateFrom: '', dateTo: '', fulfillment: '', payment: '', search: '' },
      sort: 'priority', page: 1, pageSize: MAX_BULK_ORDER_DOCUMENTS, now, thresholds: operational.thresholds,
      managedProviderAvailable: operational.managedProviderAvailable, originCountry: tenant.country, tenantPreparationMode: operational.preparationMode,
    }).catch(() => null)
    const rows: PrepareRow[] = ((queue?.rows ?? []) as unknown as Array<Omit<OperationalOrder, 'order_items'> & { id: string; full_name: string | null; email: string | null; order_items: Array<{ quantity: number; storage_type: string | null }> }>).map((order) => {
      const operation = classifyOrderOperation({ ...order, originCountry: tenant.country, managedProviderAvailable: operational.managedProviderAvailable, tenantPreparationMode: operational.preparationMode }, operational.thresholds, now)
      return {
        id: order.id, ref: `#${order.id.slice(0, 8).toUpperCase()}`, customer: order.full_name ?? order.email ?? 'Client',
        createdAt: formatDate(order.created_at, 'datetime'), units: order.order_items.reduce((sum, item) => sum + item.quantity, 0), lines: order.order_items.length,
        pickup: order.fulfillment_type === 'pickup', country: order.fulfillment_type === 'delivery' ? order.shipping_address?.country ?? null : null,
        international: operation.handling.international, fresh: operation.handling.fresh, frozen: operation.handling.frozen,
        step: operation.step, urgency: operation.urgency, action: operation.action.label,
      }
    })
    return (
      <div className="mx-auto w-full max-w-5xl space-y-4 pb-10">
        <AdminPageHeader breadcrumb={breadcrumb} title="Session de préparation" description="Choisissez les commandes à préparer ensemble : Lepefy regroupe les articles et imprime les listes." />
        <Panel title={`Commandes à préparer${queue ? ` · ${formatNumber(queue.total)}` : ''}`} flush>
          {queue ? <TodayPrepareList rows={rows} total={queue.total} /> : <EmptyState title="Liste indisponible." description="Réessayez dans un instant." />}
        </Panel>
      </div>
    )
  }

  const readOrders = (columns: string) => db.from('orders').select(columns).eq('tenant_id', tenant.id).in('id', ids)
  const [firstRead, loaded, { data: pickRaw }] = await Promise.all([
    readOrders(SESSION_COLUMNS),
    loadOrderDocumentData(db, { tenantId: tenant.id, orderIds: ids, mode: 'picking' }).catch(() => null),
    db.from('order_items').select('order_id, product_id, name, picked_at').eq('tenant_id', tenant.id).in('order_id', ids),
  ])
  // Before migration 160: same page without its columns (digital mode).
  const { data: ordersRaw } = isMissingPreparationColumn(firstRead.error) ? await readOrders(withoutPreparationColumns(SESSION_COLUMNS)) : firstRead
  const byId = new Map(((ordersRaw ?? []) as unknown as SessionOrderRow[]).map((order) => [order.id, order]))
  const excluded: Array<{ id: string; reason: string; name: string | null }> = []
  const eligible: string[] = []
  for (const id of ids) {
    const order = byId.get(id)
    if (!order) continue
    const reason = order.status === 'stock_conflict' ? 'stock_conflict'
      : order.status !== 'new' && order.status !== 'preparing' ? 'closed'
        : order.payment_status !== 'paid' ? 'payment' : null
    if (reason) excluded.push({ id, reason: EXCLUSION[reason]!, name: order.full_name })
    else eligible.push(id)
  }
  const missing = ids.filter((id) => !byId.has(id)).length

  const picked = new Map<string, Array<{ product_id: string | null; name: string; picked_at: string | null }>>()
  for (const row of (pickRaw ?? []) as Array<{ order_id: string; product_id: string | null; name: string; picked_at: string | null }>) {
    picked.set(row.order_id, [...(picked.get(row.order_id) ?? []), row])
  }
  const inputs = (loaded?.orders ?? []).filter(({ order }) => eligible.includes(order.id)).map((entry) => {
    const session = byId.get(entry.order.id)!
    const trackDigital = session.status === 'preparing' && orderPreparationMode(session).picking === 'digital'
    const pickedRows = [...(picked.get(entry.order.id) ?? [])]
    return {
      ...entry,
      trackDigital,
      // Same order of rows as the document loader: match picks by product and name.
      items: entry.items.map((item) => {
        const index = pickedRows.findIndex((row) => row.product_id === item.product_id && row.name === item.name)
        const match = index >= 0 ? pickedRows.splice(index, 1)[0] : undefined
        return { ...item, picked_at: match?.picked_at ?? null }
      }),
    }
  })
  const catalogue = await loadCatalogueFacts(db, tenant.id, inputs.flatMap(({ items }) => items.map((item) => item.product_id)))
  const summary = buildPreparationSummary(inputs, catalogue)
  const removeHref = (id: string) => {
    const rest = ids.filter((other) => other !== id)
    return rest.length ? `/admin/orders/preparation?ids=${rest.join(',')}` : '/admin/orders/preparation'
  }
  const paperOrders = eligible.filter((id) => { const order = byId.get(id); return order && (order.preparation_mode ? orderPreparationMode(order).picking === 'paper' : operational.preparationMode.picking === 'paper') }).length
  const notPrinted = eligible.filter((id) => !byId.get(id)?.picking_list_printed_at).length

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-10">
      <AdminPageHeader
        breadcrumb={breadcrumb}
        title={`Session de préparation · ${pluralize(summary.orderCount, 'commande')}`}
        meta={`${pluralize(summary.totalUnits, 'article')} · ${summary.referenceCount} réf.`}
        description={paperOrders > 0 ? `Préparation ${PREPARATION_MODE_LABELS.paper.toLowerCase()} : imprimez, préparez avec la feuille, puis confirmez « Préparation terminée » sur chaque commande.` : 'Articles regroupés dans l’ordre du parcours : secs, frais, puis surgelés.'}
      />

      {requested.length > MAX_BULK_ORDER_DOCUMENTS && <InlineAlert tone="warning">Seules les {MAX_BULK_ORDER_DOCUMENTS} premières commandes de la sélection sont reprises.</InlineAlert>}
      {missing > 0 && <InlineAlert tone="warning">{pluralize(missing, 'commande introuvable', 'commandes introuvables')} : écartée{missing > 1 ? 's' : ''} de la session.</InlineAlert>}
      {excluded.length > 0 && (
        <InlineAlert tone="warning" title={`${pluralize(excluded.length, 'commande écartée', 'commandes écartées')}`}>
          <ul className="mt-1 space-y-0.5">
            {excluded.map((entry) => <li key={entry.id}><Link href={`/admin/orders/${entry.id}`} className="font-mono underline">#{entry.id.slice(0, 8).toUpperCase()}</Link> {entry.name ?? ''} — {entry.reason}</li>)}
          </ul>
        </InlineAlert>
      )}
      {!loaded && <InlineAlert tone="danger">Les articles n’ont pas pu être chargés. Réessayez dans un instant.</InlineAlert>}

      {summary.orderCount === 0 ? (
        <EmptyState title="Aucune commande à préparer dans cette sélection." action={<Link href="/admin/orders/preparation" className="font-semibold underline">Choisir des commandes</Link>} />
      ) : <>
        <PreparationSessionActions
          orderIds={eligible}
          canManage={canManage}
          defaultFormat={documentSettings.config.picking_list_format}
          notPrinted={notPrinted}
        />

        <section aria-label="Commandes de la session" className="flex flex-wrap gap-1.5">
          {summary.orders.map((order) => (
            <span key={order.orderId} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-a-border bg-a-surface pl-3 pr-1 text-sm">
              <Link href={`/admin/orders/${order.orderId}`} className="font-mono text-xs font-semibold text-a-text-2 hover:underline">#{order.ref}</Link>
              <span className="max-w-[10rem] truncate">{order.customerName}</span>
              <span className="text-xs text-a-text-3">· {order.fulfillmentLabel}{order.cold ? ' · froid' : ''}</span>
              <Link href={removeHref(order.orderId)} aria-label={`Retirer #${order.ref} de la session`} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-a-text-3 hover:bg-a-hover hover:text-a-text">
                <IconX size={14} aria-hidden="true" />
              </Link>
            </span>
          ))}
        </section>

        {summary.linesToCheck > 0 && <InlineAlert tone="warning">{pluralize(summary.linesToCheck, 'article à vérifier', 'articles à vérifier')} dans le catalogue (produit retiré, désactivé ou stock négatif).</InlineAlert>}

        {summary.groups.map((group) => {
          const GroupIcon = GROUP_ICON[group.storage]
          return (
            <Panel key={group.storage} title={<span className="inline-flex items-center gap-1.5">{GroupIcon && <GroupIcon size={17} aria-hidden="true" />}{group.label} · {group.lines.length} réf.</span>} description={group.hint ?? undefined} flush>
              <ul className="divide-y divide-a-border">
                {group.lines.map((line) => {
                  const remaining = line.perOrder.filter((entry) => entry.picked === false).length
                  const tracked = line.perOrder.some((entry) => entry.picked !== null)
                  return (
                    <li key={line.key} className="grid gap-2 px-4 py-3 sm:grid-cols-[5rem_minmax(0,1fr)_4rem] sm:items-start">
                      <span className={cn('font-mono text-sm font-semibold', line.location ? 'text-a-text' : 'text-a-text-3')}>{line.location ?? 'sans empl.'}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-a-text">{line.name}</p>
                        {line.nameAlt && <p className="text-xs text-a-text-3">{line.nameAlt}</p>}
                        {line.catalogueWeight && <p className="text-xs text-a-text-3">Poids catalogue : {line.catalogueWeight}</p>}
                        <p className="mt-1 flex flex-wrap gap-1">
                          {line.perOrder.map((entry) => (
                            <Badge key={entry.orderId} tone={entry.picked ? 'success' : 'neutral'} icon={entry.picked ? <IconCheck size={12} aria-hidden="true" /> : undefined}>
                              #{entry.ref} × {entry.quantity}{entry.picked ? <span className="sr-only"> (prélevé)</span> : null}
                            </Badge>
                          ))}
                        </p>
                        {line.check && <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-tone-warning-fg"><IconAlertTriangle size={13} aria-hidden="true" />À vérifier : {line.check}</p>}
                        {tracked && <p className="mt-1 text-xs text-a-text-3">{remaining === 0 ? 'Prélevé pour toutes les commandes suivies dans Lepefy.' : `Reste à prélever pour ${pluralize(remaining, 'commande')}.`}</p>}
                      </div>
                      <b className="text-right text-2xl font-bold tabular-nums text-a-text">×{line.total}</b>
                    </li>
                  )
                })}
              </ul>
            </Panel>
          )
        })}
      </>}
    </div>
  )
}
