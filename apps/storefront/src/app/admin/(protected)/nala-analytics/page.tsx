import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  IconArrowUpRight,
  IconBrain,
  IconBulb,
  IconChartBar,
  IconMessageCircle2,
  IconReceipt2,
  IconSearch,
  IconShoppingCart,
  IconSparkles,
  IconTargetArrow,
} from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { hasTenantFeature, PLATFORM_FEATURE_KEYS } from '@/lib/entitlements/tenantEntitlements';
import {
  loadNalaAnalyticsDashboard,
  parseNalaDashboardRange,
  type NalaDashboardRange,
} from '@/lib/admin/nalaAnalyticsDashboard';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams?: { range?: string | string[] };
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

function KpiCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-950 dark:text-white">{value}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--admin-primary-soft)] text-[var(--admin-primary-fg)]">
          {icon}
        </span>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{detail}</p>
    </article>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-950 dark:text-white">{title}</h2>
        {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-400 dark:border-gray-800">
      {children}
    </div>
  );
}

function RangeTabs({ active }: { active: NalaDashboardRange }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--admin-border)] bg-white p-1 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      {[7, 30, 90].map((range) => (
        <Link
          key={range}
          href={`/admin/nala-analytics?range=${range}`}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] ${
            active === range
              ? 'bg-[var(--admin-primary)] text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
          }`}
        >
          {range} j
        </Link>
      ))}
    </div>
  );
}

export default async function NalaAnalyticsPage({ searchParams }: PageProps) {
  const range = parseNalaDashboardRange(searchParams?.range);
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const supabase = createServiceClient();

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, currency')
    .eq('slug', slug)
    .single();

  if (tenantError || !tenant) redirect('/admin');

  let analyticsEntitled = false;
  try {
    analyticsEntitled = await hasTenantFeature(tenant.id, PLATFORM_FEATURE_KEYS.nalaAnalytics);
  } catch (error) {
    console.error('[nala-dashboard] Unable to resolve analytics entitlement.', { tenantId: tenant.id, error });
  }

  if (!analyticsEntitled) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Croissance</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Nala Analytics</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Mesurez ce que les clients demandent à Nala et ce qui contribue aux ventes.</p>
        </header>
        <section className="rounded-2xl border border-violet-200 bg-violet-50/70 p-5 dark:border-violet-900/60 dark:bg-violet-950/20">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-violet-700 shadow-sm dark:bg-violet-950 dark:text-violet-300"><IconSparkles size={20} /></span>
            <div>
              <h2 className="font-semibold text-violet-950 dark:text-violet-100">Nala Analytics n’est pas actif pour ce tenant</h2>
              <p className="mt-1 text-sm text-violet-800/80 dark:text-violet-200/70">Les données de conversation restent privées et aucune métrique n’est exposée ici sans entitlement commercial.</p>
              <Link href="/admin/billing" className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
                Voir l’abonnement <IconArrowUpRight size={16} />
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  let dashboard;
  try {
    dashboard = await loadNalaAnalyticsDashboard({
      supabase,
      tenantId: tenant.id,
      rangeDays: range,
      fallbackCurrency: tenant.currency ?? 'EUR',
    });
  } catch (error) {
    console.error('[nala-dashboard] Unable to load dashboard.', { tenantId: tenant.id, error });
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Croissance</p>
          <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Nala Analytics</h1>
        </header>
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
          Les statistiques Nala sont momentanément indisponibles. Nala et le parcours d’achat continuent de fonctionner normalement.
        </section>
      </div>
    );
  }

  const maxDailyInteractions = Math.max(1, ...dashboard.daily.map((item) => item.interactions));
  const maxIntentCount = Math.max(1, ...dashboard.intents.map((item) => item.count));

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Croissance</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="text-xl font-semibold text-gray-950 dark:text-white">Nala Analytics</h1>
            <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">Beta</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Comprenez les demandes clients, les opportunités manquées et les ventes assistées par Nala pour {tenant.name}.
          </p>
        </div>
        <RangeTabs active={range} />
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Conversations" value={dashboard.sessions.toLocaleString('fr-FR')} detail={`${dashboard.interactions.toLocaleString('fr-FR')} messages sur la période`} icon={<IconMessageCircle2 size={20} />} />
        <KpiCard label="Ajouts au panier" value={dashboard.addToCartEvents.toLocaleString('fr-FR')} detail={`${dashboard.checkoutCount.toLocaleString('fr-FR')} checkout${dashboard.checkoutCount > 1 ? 's' : ''} assisté${dashboard.checkoutCount > 1 ? 's' : ''}`} icon={<IconShoppingCart size={20} />} />
        <KpiCard label="Commandes assistées" value={dashboard.orderCount.toLocaleString('fr-FR')} detail={`${formatPercent(dashboard.assistedOrderRate)} des conversations ont mené à une commande assistée`} icon={<IconTargetArrow size={20} />} />
        <KpiCard label="CA assisté" value={formatCurrency(dashboard.assistedRevenue, dashboard.currency)} detail="Valeur brute des articles attribués à Nala, hors livraison et remises globales" icon={<IconReceipt2 size={20} />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <SectionCard title="Activité récente" subtitle="Interactions Nala sur les 14 derniers jours maximum dans la période sélectionnée.">
          <div className="flex h-44 items-end gap-1.5 sm:gap-2">
            {dashboard.daily.map((item) => {
              const height = item.interactions === 0 ? 4 : Math.max(10, Math.round((item.interactions / maxDailyInteractions) * 100));
              return (
                <div key={item.key} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <div className="relative flex h-32 w-full items-end rounded-lg bg-gray-50 px-1 dark:bg-gray-800/70">
                    <div className="w-full rounded-md bg-[var(--admin-primary)]/80 transition-all group-hover:bg-[var(--admin-primary)]" style={{ height: `${height}%` }} />
                    <span className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-950 px-2 py-1 text-[10px] font-medium text-white shadow-lg group-hover:block">
                      {item.interactions} interactions{item.assistedRevenue > 0 ? ` · ${formatCurrency(item.assistedRevenue, dashboard.currency)}` : ''}
                    </span>
                  </div>
                  <span className="truncate text-[9px] text-gray-400 sm:text-[10px]">{item.label}</span>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard title="Qualité des réponses" subtitle="Signaux issus du Semantic Enrichment.">
          <div className="space-y-3">
            <div className="rounded-xl bg-rose-50 p-3 dark:bg-rose-950/20">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-rose-900 dark:text-rose-200">Demande non satisfaite</span><strong className="text-sm text-rose-950 dark:text-rose-100">{dashboard.unmetDemand}</strong></div>
              <p className="mt-1 text-xs text-rose-800/70 dark:text-rose-300/70">{formatPercent(dashboard.unmetDemandRate)} des interactions</p>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-950/20">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-amber-900 dark:text-amber-200">Informations manquantes</span><strong className="text-sm text-amber-950 dark:text-amber-100">{dashboard.knowledgeGaps}</strong></div>
              <p className="mt-1 text-xs text-amber-800/70 dark:text-amber-300/70">Knowledge gaps à corriger dans la base IA</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
              <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-gray-800 dark:text-gray-200">Retrieval faible / vide</span><strong className="text-sm text-gray-950 dark:text-white">{dashboard.retrievalIssues}</strong></div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Couverture enrichment : {formatPercent(dashboard.enrichmentCoverage)}</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Ce que les clients demandent" subtitle="Intentions principales détectées dans les conversations.">
          {dashboard.intents.length === 0 ? <EmptyState>Pas encore assez de conversations classées.</EmptyState> : (
            <div className="space-y-3">
              {dashboard.intents.map((intent) => (
                <div key={intent.key}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                    <span className="font-medium text-gray-700 dark:text-gray-200">{intent.label}</span>
                    <span className="text-gray-400">{intent.count} · {formatPercent(intent.share)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-full rounded-full bg-[var(--admin-primary)]" style={{ width: `${Math.max(3, Math.round((intent.count / maxIntentCount) * 100))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Demandes à transformer en opportunités" subtitle="Produits ou catégories demandés mais non satisfaits.">
          {dashboard.unmetRequests.length === 0 ? <EmptyState>Aucune demande produit non satisfaite avec libellé exploitable sur cette période.</EmptyState> : (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {dashboard.unmetRequests.map((item, index) => (
                <div key={`${item.label}:${index}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300"><IconSearch size={16} /></span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{item.label}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">{item.count}×</span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <SectionCard title="Cart Builder" subtitle="Recettes transformées en propositions de panier.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950/20"><p className="text-xs text-violet-700 dark:text-violet-300">Propositions</p><p className="mt-1 text-2xl font-semibold text-violet-950 dark:text-white">{dashboard.cartBuilderProposals}</p></div>
            <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/20"><p className="text-xs text-emerald-700 dark:text-emerald-300">Acceptées</p><p className="mt-1 text-2xl font-semibold text-emerald-950 dark:text-white">{dashboard.cartBuilderAccepted}</p></div>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Taux d’acceptation : <strong className="text-gray-800 dark:text-gray-200">{formatPercent(dashboard.cartBuilderAcceptanceRate)}</strong></p>
        </SectionCard>

        <SectionCard title="Produits proposés" subtitle="Origine des Structured Product Actions.">
          {dashboard.relationshipTypes.length === 0 ? <EmptyState>Aucune action produit sur cette période.</EmptyState> : (
            <div className="space-y-2.5">
              {dashboard.relationshipTypes.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5 dark:bg-gray-800/70">
                  <span className="text-sm text-gray-700 dark:text-gray-200">{item.label}</span>
                  <strong className="text-sm text-gray-950 dark:text-white">{item.count}</strong>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Actions recommandées" subtitle="Les signaux à traiter en priorité.">
          <div className="space-y-3">
            <Link href="/admin/ai-lab" className="flex min-h-12 items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:border-violet-200 hover:bg-violet-50 dark:border-gray-800 dark:text-gray-200 dark:hover:border-violet-900 dark:hover:bg-violet-950/20">
              <IconBrain size={18} className="text-violet-600" /><span className="flex-1">Corriger {dashboard.knowledgeGaps} knowledge gap{dashboard.knowledgeGaps > 1 ? 's' : ''}</span><IconArrowUpRight size={16} />
            </Link>
            <Link href="/admin/catalogue" className="flex min-h-12 items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium text-gray-800 transition-colors hover:border-violet-200 hover:bg-violet-50 dark:border-gray-800 dark:text-gray-200 dark:hover:border-violet-900 dark:hover:bg-violet-950/20">
              <IconBulb size={18} className="text-amber-600" /><span className="flex-1">Explorer {dashboard.unmetDemand} demande{dashboard.unmetDemand > 1 ? 's' : ''} non satisfaite{dashboard.unmetDemand > 1 ? 's' : ''}</span><IconArrowUpRight size={16} />
            </Link>
            <div className="flex min-h-12 items-center gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-gray-600 dark:bg-gray-800/70 dark:text-gray-300">
              <IconChartBar size={18} className="text-emerald-600" /><span>{dashboard.orderCount} commande{dashboard.orderCount > 1 ? 's' : ''} assistée{dashboard.orderCount > 1 ? 's' : ''} · {formatCurrency(dashboard.assistedRevenue, dashboard.currency)}</span>
            </div>
          </div>
        </SectionCard>
      </div>

      <footer className="flex flex-col gap-2 border-t border-[var(--admin-border)] pt-4 text-xs text-gray-400 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <span>Données brutes de conversation conservées selon la rétention Nala existante. Le CA est une attribution assistée, pas une causalité.</span>
        <span className="inline-flex items-center gap-1"><IconSparkles size={14} /> Nala Analytics · {range} jours</span>
      </footer>
    </div>
  );
}
