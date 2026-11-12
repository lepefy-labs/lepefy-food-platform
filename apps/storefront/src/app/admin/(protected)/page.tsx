import { redirect } from 'next/navigation'
import { IconArrowRight, IconBuildingStore } from '@tabler/icons-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getTenant } from '@/lib/tenant/getTenant'
import { ORDER_LIST } from '@/lib/orders/orderListParams'
import { countryDisplayName, flagSrc, isIsoCountry } from '@/lib/address/countries'
import { formatMoney, formatNumber, pluralize } from '@/lib/admin/format'
import {
  bucketAxisLabel, bucketLongLabel, compareValues, fillSeries, FULFILLMENT_LABELS, HEATMAP_DAYS, HEATMAP_SLOTS, heatmapGrid, LIMITED_DATA_ORDERS,
  metricValue, PAYMENT_METHOD_LABELS, PERIOD_LABELS, parseStatisticsQuery, plottedValues, rangeLabel, rankCategories, shares, statisticsHref,
  type SalesStatistics, type StatisticsMetric,
} from '@/lib/admin/salesStatistics'
import { loadSalesStatistics } from '@/lib/admin/salesStatisticsServer'
import AdminPageHeader from '../_components/ui/AdminPageHeader'
import { ButtonLink } from '../_components/ui/Button'
import InlineAlert from '../_components/ui/InlineAlert'
import { EmptyState, ErrorState } from '../_components/ui/States'
import StatTile, { Sparkline } from '../_components/charts/StatTile'
import TrendChart, { type TrendPoint } from '../_components/charts/TrendChart'
import BarList from '../_components/charts/BarList'
import SegmentedBar from '../_components/charts/SegmentedBar'
import Heatmap from '../_components/charts/Heatmap'
import ChartDataTable from '../_components/charts/ChartDataTable'
import { CHART_ACCENT, CHART_SERIES, formatChartValue } from '../_components/charts/chartTheme'
import StatisticsControls, { SegmentedLinks } from './StatisticsControls'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/** Orders list query keys (ORDER_LIST): an old /admin?… link is an orders link. */
const ORDER_LIST_KEYS = [...Object.keys(ORDER_LIST.spec), 'page', 'size']

const METRICS: Array<{ key: StatisticsMetric; label: string; title: string }> = [
  { key: 'revenue', label: 'Chiffre d’affaires', title: 'Évolution du chiffre d’affaires' },
  { key: 'orders', label: 'Commandes', title: 'Évolution des commandes' },
  { key: 'average', label: 'Panier moyen', title: 'Évolution du panier moyen' },
]

// min-w-0: a grid item's min width defaults to its min-content, and the hidden data table
// of a card (« Voir les données ») would widen the whole page on a phone.
const CARD = 'min-w-0 rounded-2xl border border-a-border bg-a-surface p-4 sm:p-5'

/**
 * « Statistiques » — home of the shop workspace (/admin). Sales of the
 * period from one aggregated RPC (admin_sales_statistics, migration 181),
 * compared with the previous period of the same length. Pure rules in
 * lib/admin/salesStatistics.ts; charts in _components/charts.
 */
export default async function AdminStatisticsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  // Back-compat: /admin?status=…, ?view=…, ?q=… (notifications, bookmarks) open the orders list.
  const legacy = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (!ORDER_LIST_KEYS.includes(key)) continue
    for (const entry of Array.isArray(value) ? value : [value]) if (entry !== undefined) legacy.append(key, entry)
  }
  if (legacy.toString()) redirect(`/admin/orders?${legacy.toString()}`)

  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')
  const currency = tenant.currency || 'EUR'
  const query = parseStatisticsQuery(searchParams)
  const periodName = query.period === 'custom' ? 'la période' : PERIOD_LABELS[query.period].long

  const header = (
    <AdminPageHeader
      title="Statistiques"
      description={<>Ventes payées de la boutique, hors commandes test et annulations · <span className="text-a-text">{rangeLabel(query.range)}</span></>}
      actions={<StatisticsControls query={query} />}
    />
  )

  let data: { current: SalesStatistics; previous: SalesStatistics | null }
  try {
    data = await loadSalesStatistics(createServiceClient(), tenant.id, query)
  } catch (error) {
    console.error('[admin/statistics] load failed', tenant.id, error)
    return (
      <div className="mx-auto w-full max-w-7xl pb-10">
        {header}
        <ErrorState title="Statistiques momentanément indisponibles." description="Les commandes restent accessibles dans Commandes." action={<ButtonLink href="/admin">Réessayer</ButtonLink>} />
      </div>
    )
  }

  const { current, previous } = data
  const totals = current.totals
  const limited = totals.orders < LIMITED_DATA_ORDERS
  // Counts compared with a small previous period read as raw differences (« +17 », not « +567 % »).
  const countsLimited = limited || (previous !== null && previous.totals.orders < LIMITED_DATA_ORDERS)
  const average = totals.orders > 0 ? totals.revenue / totals.orders : 0
  const previousAverage = previous && previous.totals.orders > 0 ? previous.totals.revenue / previous.totals.orders : 0
  const money = (value: number) => formatMoney(value, currency)
  const previousWord = query.period === '12m' ? 'les 12 mois précédents' : `les ${formatNumber(query.range.days)} j précédents`

  const points = fillSeries(current.series, query.range, query.bucket)
  const previousPoints = previous ? fillSeries(previous.series, query.previous, query.bucket) : []
  const spark = (metric: StatisticsMetric) => points.map((point) => metricValue(point, metric) ?? 0)

  const metric = METRICS.find((item) => item.key === query.metric)!
  const plotted = plottedValues(points, query.metric, query.display)
  const plottedPrevious = previous ? plottedValues(previousPoints, query.metric, query.display) : undefined
  const format = query.metric === 'orders' ? 'number' : 'money'
  const trendPoints: TrendPoint[] = points.map((point, index) => ({
    key: point.bucket,
    axisLabel: bucketAxisLabel(point.bucket, query.bucket),
    title: bucketLongLabel(point.bucket, query.bucket),
    value: plotted[index] ?? null,
    detail: query.display === 'cumulative'
      ? `${query.bucket === 'day' ? 'ce jour' : query.bucket === 'week' ? 'cette semaine' : 'ce mois'} : ${pluralize(point.orders, 'commande', 'commandes')} · ${money(point.revenue)}`
      : query.metric === 'revenue' ? pluralize(point.orders, 'commande', 'commandes') : undefined,
  }))
  const headline = query.metric === 'revenue' ? money(totals.revenue) : query.metric === 'orders' ? formatNumber(totals.orders) : money(average)
  const headlineCaption = query.metric === 'average' ? `sur ${pluralize(totals.orders, 'commande', 'commandes')}` : `au total, ${rangeLabel(query.range)}`

  const categories = rankCategories(current.categories)
  const products = current.products.slice(0, 8)
  const pickup = current.fulfillment.find((row) => row.key === 'pickup')
  const destinations = [
    ...current.countries.map((row) => ({ key: row.key ?? 'unknown', label: row.key && isIsoCountry(row.key) ? countryDisplayName(row.key) : 'Pays non renseigné', code: row.key && isIsoCountry(row.key) ? row.key : null, orders: row.orders, revenue: row.revenue })),
    ...(pickup && pickup.orders > 0 ? [{ key: 'pickup', label: 'Retrait en boutique', code: null, orders: pickup.orders, revenue: pickup.revenue }] : []),
  ].sort((a, b) => b.revenue - a.revenue)
  const grid = heatmapGrid(current.heatmap)

  const fulfillmentShares = shares(['delivery', 'pickup'].map((key) => ({ key, label: FULFILLMENT_LABELS[key]!, value: current.fulfillment.find((row) => row.key === key)?.orders ?? 0 })))
  const paymentShares = shares(current.paymentMethods.map((row) => ({ key: row.key ?? 'unknown', label: PAYMENT_METHOD_LABELS[row.key ?? ''] ?? 'Autre', value: row.revenue })))
  const customerShares = shares([
    { key: 'new', label: '1ʳᵉ commande', value: totals.newCustomers },
    { key: 'returning', label: 'Déjà clients', value: totals.returningCustomers },
  ])
  const percent = (share: number) => `${formatNumber(share * 100)} %`

  const metricLinks = METRICS.map((item) => ({ key: item.key, label: item.label, href: statisticsHref(query, { metric: item.key }), active: item.key === query.metric }))
  const displayLinks = [
    { key: 'cumulative', label: 'Cumulé', href: statisticsHref(query, { display: 'cumulative' }), active: query.display === 'cumulative' },
    { key: 'daily', label: query.bucket === 'day' ? 'Par jour' : query.bucket === 'week' ? 'Par semaine' : 'Par mois', href: statisticsHref(query, { display: 'daily' }), active: query.display === 'daily' },
  ]

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 pb-10">
      {header}

      {query.invalidCustom && <InlineAlert tone="warning">Les dates choisies ne sont pas valides (au plus 3 ans, la fin après le début) : affichage des 30 derniers jours.</InlineAlert>}

      <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Chiffre d’affaires" value={money(totals.revenue)}
          delta={previous ? compareValues(totals.revenue, previous.totals.revenue, { limited, kind: 'amount' }) : null}
          comparison={previous ? <span>vs {money(previous.totals.revenue)} {previousWord}</span> : undefined}
          trend={<span className="hidden sm:block"><Sparkline values={spark('revenue')} color={CHART_ACCENT} /></span>} />
        <StatTile label="Commandes" value={formatNumber(totals.orders)}
          delta={previous ? compareValues(totals.orders, previous.totals.orders, { limited: countsLimited, kind: 'count' }) : null}
          comparison={previous ? <span>vs {formatNumber(previous.totals.orders)}</span> : undefined}
          trend={<span className="hidden sm:block"><Sparkline values={spark('orders')} color={CHART_SERIES[0]} /></span>} />
        <StatTile label="Panier moyen" value={totals.orders ? money(average) : '—'}
          delta={previous && totals.orders ? compareValues(average, previousAverage, { limited, kind: 'amount' }) : null}
          comparison={previous && previous.totals.orders ? <span>vs {money(previousAverage)}</span> : undefined}
          trend={<span className="hidden sm:block"><Sparkline values={spark('average')} color={CHART_SERIES[1]} /></span>} />
        <StatTile label="Clients acheteurs" value={formatNumber(totals.customers)}
          delta={previous ? compareValues(totals.customers, previous.totals.customers, { limited: countsLimited, kind: 'count' }) : null}
          comparison={previous ? <span>vs {formatNumber(previous.totals.customers)}</span> : undefined}>
          <p className="text-xs text-a-text-2">
            <b className="font-semibold tabular-nums text-a-text">{formatNumber(totals.newCustomers)}</b> {totals.newCustomers > 1 ? 'nouveaux' : 'nouveau'} ·{' '}
            <b className="font-semibold tabular-nums text-a-text">{formatNumber(totals.returningCustomers)}</b> {totals.returningCustomers > 1 ? 'fidèles' : 'fidèle'}
          </p>
        </StatTile>
      </section>

      {totals.orders === 0 ? (
        <EmptyState title="Pas encore de ventes sur cette période" description={`Aucune commande payée ${periodName === 'la période' ? 'sur la période choisie' : `sur les ${periodName}`}. Essayez une période plus longue.`}
          action={query.period !== '12m' ? <ButtonLink href={statisticsHref(query, { period: '12m' })}>Voir les 12 derniers mois</ButtonLink> : undefined} />
      ) : (
        <>
          {limited && (
            <InlineAlert tone="info">
              Encore peu de commandes sur la période ({formatNumber(totals.orders)}) : les variations sont données en valeurs, pas en pourcentage, pour ne pas exagérer les écarts.
            </InlineAlert>
          )}

          <section aria-labelledby="stats-trend-title" className={CARD}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <h2 id="stats-trend-title" className="text-base font-semibold text-a-text">{metric.title}</h2>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-3xl font-bold tabular-nums tracking-tight text-a-text">{headline}</span>
                  <span className="text-sm text-a-text-3">{headlineCaption}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <SegmentedLinks label="Indicateur" options={metricLinks} size="sm" />
                <SegmentedLinks label="Affichage" options={displayLinks} size="sm" />
              </div>
            </div>
            <TrendChart className="mt-4" points={trendPoints} previous={plottedPrevious}
              mode={query.display === 'cumulative' ? 'area' : 'bars'} format={format} currency={currency}
              currentLabel={query.display === 'cumulative' ? 'Cumulé' : metric.label}
              previousLabel={previous ? 'Période préc.' : undefined}
              ariaLabel={`${metric.title}, ${rangeLabel(query.range)} : ${headline}${previous ? `, contre ${query.metric === 'revenue' ? money(previous.totals.revenue) : query.metric === 'orders' ? formatNumber(previous.totals.orders) : money(previousAverage)} sur la période précédente` : ''}`} />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-a-text-2">
                <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-0.5 w-4 rounded" style={{ background: CHART_ACCENT }} />{rangeLabel(query.range)}</li>
                {previous && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t-2 border-dashed border-a-text-3" />{rangeLabel(query.previous)}</li>}
              </ul>
              <ChartDataTable caption={metric.title}
                columns={['Période', 'Commandes', 'Chiffre d’affaires', ...(previous ? ['Commandes (préc.)', 'CA (préc.)'] : [])]}
                rows={points.map((point, index) => [
                  bucketLongLabel(point.bucket, query.bucket), formatNumber(point.orders), money(point.revenue),
                  ...(previous ? [formatNumber(previousPoints[index]?.orders ?? 0), money(previousPoints[index]?.revenue ?? 0)] : []),
                ])} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="stats-categories-title" className={CARD}>
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 id="stats-categories-title" className="text-base font-semibold text-a-text">Ventes par catégorie</h2>
                <span className="text-xs text-a-text-3">CA des articles</span>
              </div>
              <BarList color={CHART_SERIES[0]} empty="Aucun article vendu."
                items={categories.map((item) => ({ key: item.key, label: item.label, value: item.value, valueLabel: money(item.value), detail: percent(item.share), other: item.other }))} />
            </section>

            <section aria-labelledby="stats-products-title" className={CARD}>
              <div className="mb-4 flex items-baseline justify-between gap-3">
                <h2 id="stats-products-title" className="text-base font-semibold text-a-text">Produits les plus vendus</h2>
                <span className="text-xs text-a-text-3">par chiffre d’affaires</span>
              </div>
              <BarList ranked color={CHART_ACCENT} empty="Aucun article vendu."
                items={products.map((product, index) => ({
                  key: product.id ?? `line-${index}`, label: product.name, value: product.revenue, valueLabel: money(product.revenue),
                  detail: `${formatNumber(product.units)} ${product.units > 1 ? 'vendus' : 'vendu'}`, href: product.id ? `/admin/catalogue/${product.id}` : undefined,
                }))} />
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <section aria-labelledby="stats-mix-title" className={`${CARD} flex flex-col gap-5`}>
              <h2 id="stats-mix-title" className="text-base font-semibold text-a-text">Comment on vous achète</h2>
              <SegmentedBar title="Mode de remise (commandes)" segments={fulfillmentShares.map((item) => ({ key: item.key, label: item.label, value: item.value, valueLabel: `${formatNumber(item.value)} · ${percent(item.share)}` }))} />
              <SegmentedBar title="Paiement (part du CA)" segments={paymentShares.map((item) => ({ key: item.key, label: item.label, value: item.value, valueLabel: percent(item.share) }))} />
              <SegmentedBar title="Clients" segments={customerShares.map((item) => ({ key: item.key, label: item.label, value: item.value, valueLabel: formatNumber(item.value) }))} empty="Clients non identifiés sur la période." />
            </section>

            <section aria-labelledby="stats-geo-title" className={CARD}>
              <h2 id="stats-geo-title" className="mb-4 text-base font-semibold text-a-text">Destinations</h2>
              <BarList layout="stacked" color={CHART_SERIES[0]} empty="Aucune livraison sur la période."
                items={destinations.map((row) => ({
                  key: row.key, label: row.label, value: row.revenue, valueLabel: money(row.revenue), detail: pluralize(row.orders, 'commande', 'commandes'), other: row.key === 'pickup',
                  leading: row.code
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={flagSrc(row.code)} alt="" width={20} height={15} className="h-[15px] w-5 shrink-0 rounded-sm border border-a-border object-cover" />
                    : row.key === 'pickup' ? <IconBuildingStore size={18} aria-hidden="true" className="shrink-0 text-a-text-3" /> : undefined,
                }))} />
            </section>

            <section aria-labelledby="stats-heat-title" className={`${CARD} md:col-span-2 xl:col-span-1`}>
              <h2 id="stats-heat-title" className="text-base font-semibold text-a-text">Moments forts</h2>
              <p className="mb-3 text-xs text-a-text-3">Commandes par jour et tranche horaire (heure de la boutique)</p>
              <Heatmap grid={grid} rows={HEATMAP_DAYS} columns={HEATMAP_SLOTS} unit={['commande', 'commandes']} />
            </section>
          </div>
        </>
      )}

      <nav aria-label="Aller plus loin" className="flex flex-wrap gap-2">
        <ButtonLink href="/admin/orders" size="sm">Commandes <IconArrowRight size={16} aria-hidden="true" /></ButtonLink>
        <ButtonLink href="/admin/checkout-funnel" size="sm">Funnel checkout <IconArrowRight size={16} aria-hidden="true" /></ButtonLink>
        <ButtonLink href="/admin/paiements-carte" size="sm">Paiements carte <IconArrowRight size={16} aria-hidden="true" /></ButtonLink>
      </nav>
      <p className="text-xs text-a-text-3">
        Une commande compte si elle est payée, n’est pas une commande test et n’a pas été annulée (y compris « traitée hors plateforme »). Montants TTC, livraison incluse ; catégories et produits : montant des articles. {formatChartValue(totals.units, 'number')} {totals.units > 1 ? 'articles vendus' : 'article vendu'} sur la période.
      </p>
    </div>
  )
}
