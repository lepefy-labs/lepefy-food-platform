import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconMessageQuestion,
  IconSearch,
  IconSparkles,
} from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { hasTenantFeature, PLATFORM_FEATURE_KEYS } from '@/lib/entitlements/tenantEntitlements';
import { getTenantServiceState, isModuleAvailable } from '@/lib/billing/tenantServiceState';
import {
  loadNalaAnalyticsDashboard,
  parseNalaDashboardRange,
  type NalaDashboardRange,
  type NalaMessageExample,
} from '@/lib/admin/nalaAnalyticsDashboard';
import { ENRICHMENT_WARNING_PERCENT } from '@/lib/admin/nalaAnalyticsRules';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

interface PageProps {
  searchParams?: { range?: string | string[] };
}

function formatCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' });
}

function SectionCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--admin-border)] bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-950 dark:text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-400 dark:border-gray-800">
      {children}
    </div>
  );
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[var(--admin-primary-fg)] hover:bg-[var(--admin-primary-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)]">
      {children} <IconArrowUpRight size={14} />
    </Link>
  );
}

function ExampleList({ examples }: { examples: NalaMessageExample[] }) {
  return (
    <ul className="space-y-2">
      {examples.map((example, index) => (
        <li key={`${example.at}:${index}`} className="flex items-start gap-3 rounded-xl bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800/70">
          <span className="min-w-0 flex-1 text-gray-700 dark:text-gray-200">« {example.text} »</span>
          <span className="shrink-0 text-xs text-gray-400">{formatDay(example.at)}</span>
        </li>
      ))}
    </ul>
  );
}

function RangeTabs({ active }: { active: NalaDashboardRange }) {
  return (
    <nav aria-label="Période" className="inline-flex rounded-xl border border-[var(--admin-border)] bg-white p-1 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      {[7, 30, 90].map((range) => (
        <Link
          key={range}
          href={`/admin/nala-analytics?range=${range}`}
          aria-current={active === range ? 'page' : undefined}
          className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-primary)] ${
            active === range
              ? 'bg-[var(--admin-primary)] text-white'
              : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
          }`}
        >
          {range} jours
        </Link>
      ))}
    </nav>
  );
}

function PageHeader({ children }: { children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--admin-primary-fg)]">Croissance</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-950 dark:text-white">Nala Analytics</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          Ce que vos clients demandent à Nala, ce qu’elle ne sait pas encore répondre et les ventes qui passent par elle.
        </p>
      </div>
      {children}
    </header>
  );
}

function Notice({ tone, title, children }: { tone: 'violet' | 'amber'; title: string; children: React.ReactNode }) {
  const styles = tone === 'violet'
    ? 'border-violet-200 bg-violet-50/70 text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/20 dark:text-violet-100'
    : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200';
  return (
    <section className={`rounded-2xl border p-5 ${styles}`}>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-1 text-sm opacity-90">{children}</div>
    </section>
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

  const serviceState = await getTenantServiceState(tenant.id);
  if (!isModuleAvailable(serviceState, 'ai')) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <PageHeader />
        <Notice tone="amber" title="Module IA suspendu">
          Nala et ses statistiques sont suspendus avec l’abonnement. Les données sont conservées.{' '}
          <Link href="/admin/billing" className="font-semibold underline">Voir l’abonnement</Link>
        </Notice>
      </div>
    );
  }

  let analyticsEntitled = false;
  try {
    analyticsEntitled = await hasTenantFeature(tenant.id, PLATFORM_FEATURE_KEYS.nalaAnalytics);
  } catch (error) {
    console.error('[nala-dashboard] Unable to resolve analytics entitlement.', { tenantId: tenant.id, error });
  }

  if (!analyticsEntitled) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <PageHeader />
        <Notice tone="violet" title="Nala Analytics n’est pas inclus dans votre offre">
          Les conversations restent privées : aucune statistique n’est affichée sans l’option Analytics.{' '}
          <Link href="/admin/billing" className="font-semibold underline">Voir l’abonnement</Link>
        </Notice>
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
        <PageHeader><RangeTabs active={range} /></PageHeader>
        <Notice tone="amber" title="Statistiques momentanément indisponibles">
          Nala et le parcours d’achat continuent de fonctionner normalement. Réessayez dans quelques minutes.
        </Notice>
      </div>
    );
  }

  const maxActivity = Math.max(1, ...dashboard.activity.map((item) => item.interactions));
  const maxIntentCount = Math.max(1, ...dashboard.intents.map((item) => item.count));
  const partialAnalysis = dashboard.interactions > 0 && dashboard.enrichmentCoverage < ENRICHMENT_WARNING_PERCENT;
  const firstConversation = dashboard.funnel[0]?.count ?? 0;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <PageHeader><RangeTabs active={range} /></PageHeader>

      {partialAnalysis && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <IconAlertTriangle size={16} className="shrink-0" />
          Analyse en cours : {formatPercent(dashboard.enrichmentCoverage)} des messages sont analysés. Les questions sans réponse
          et les demandes introuvables sont donc encore incomplètes.
        </p>
      )}

      <SectionCard
        title="Parcours d’achat avec Nala"
        subtitle={`Sur ${dashboard.rangeDays} jours : combien de conversations mènent à un panier, un paiement et une commande. Une conversation = une visite où le client a écrit à Nala.`}
      >
        {firstConversation === 0 ? <EmptyState>Aucune conversation sur cette période.</EmptyState> : (
          <ol className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {dashboard.funnel.map((step, index) => (
              <li key={step.key} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800/70">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{index + 1}. {step.label}</p>
                <p className="mt-1 text-2xl font-semibold text-gray-950 dark:text-white">{step.count.toLocaleString('fr-FR')}</p>
                {index > 0 && <p className="text-xs text-gray-500 dark:text-gray-400">{formatPercent(step.rate)} des conversations</p>}
                {step.key === 'conversations' && <p className="text-xs text-gray-500 dark:text-gray-400">{dashboard.interactions.toLocaleString('fr-FR')} messages</p>}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-4 flex flex-col gap-1 border-t border-gray-100 pt-3 text-sm dark:border-gray-800 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-gray-700 dark:text-gray-200">
            Ventes assistées : <strong>{formatCurrency(dashboard.assistedRevenue, dashboard.currency)}</strong>
            {' '}· {dashboard.orderCount} commande{dashboard.orderCount > 1 ? 's' : ''}
          </p>
          <p className="text-xs text-gray-400">
            Valeur des articles proposés par Nala puis achetés, hors livraison et remises. Commandes test, annulées et remboursées exclues
            {dashboard.excludedOrders > 0 ? ` (${dashboard.excludedOrders} exclue${dashboard.excludedOrders > 1 ? 's' : ''})` : ''}.
          </p>
        </div>
      </SectionCard>

      <SectionCard
        title="Activité"
        subtitle={`Messages reçus par ${dashboard.bucketSize === 'week' ? 'semaine' : 'jour'} (heure de la boutique).`}
      >
        <div className="flex h-40 items-end gap-1 sm:gap-1.5" role="img" aria-label={`Activité Nala sur ${dashboard.rangeDays} jours`}>
          {dashboard.activity.map((item) => {
            const height = item.interactions === 0 ? 3 : Math.max(8, Math.round((item.interactions / maxActivity) * 100));
            const title = `${dashboard.bucketSize === 'week' ? `Semaine du ${item.label}` : item.label} : ${item.interactions} message${item.interactions > 1 ? 's' : ''}${item.assistedRevenue > 0 ? ` · ${formatCurrency(item.assistedRevenue, dashboard.currency)}` : ''}`;
            return (
              <div key={item.key} title={title} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <div className="w-full rounded-t-md bg-[var(--admin-primary)] opacity-80" style={{ height: `${height}%` }} />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-gray-400">
          <span>{dashboard.activity[0]?.label}</span>
          <span>{dashboard.activity[dashboard.activity.length - 1]?.label}</span>
        </div>
      </SectionCard>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title={`Questions sans réponse (${dashboard.knowledgeGaps})`}
          subtitle="Nala n’avait pas l’information. Ajoutez-la à sa base de connaissance pour qu’elle réponde la prochaine fois."
          action={<ActionLink href="/admin/ai-lab">Compléter la base IA</ActionLink>}
        >
          {dashboard.knowledgeGapExamples.length === 0
            ? <EmptyState>Aucune question sans réponse sur cette période.</EmptyState>
            : <ExampleList examples={dashboard.knowledgeGapExamples} />}
        </SectionCard>

        <SectionCard
          title={`Produits demandés introuvables (${dashboard.unmetDemand})`}
          subtitle={`${formatPercent(dashboard.unmetDemandRate)} des messages : un produit que la boutique ne propose pas, ou que Nala n’a pas trouvé.`}
        >
          {dashboard.unmetRequests.length === 0 ? <EmptyState>Aucune demande introuvable sur cette période.</EmptyState> : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {dashboard.unmetRequests.map((item, index) => (
                <li key={`${item.label}:${index}`} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300"><IconSearch size={16} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.label} <span className="text-xs font-normal text-gray-400">· {item.count}×</span></p>
                    {item.example && <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={item.example}>« {item.example} »</p>}
                  </div>
                  <ActionLink href={`/admin/catalogue?q=${encodeURIComponent(item.label.slice(0, 80))}`}>Catalogue</ActionLink>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title={`Réponses produit peu sûres (${dashboard.retrievalIssues})`}
          subtitle="Nala a trouvé peu ou pas de produits correspondants. Souvent : un nom local, une faute de frappe ou une fiche produit trop courte."
          action={<ActionLink href="/admin/catalogue">Catalogue</ActionLink>}
        >
          {dashboard.retrievalIssueExamples.length === 0
            ? <EmptyState>Rien à signaler sur cette période.</EmptyState>
            : <ExampleList examples={dashboard.retrievalIssueExamples} />}
        </SectionCard>

        <SectionCard title="Ce que les clients demandent" subtitle="Sujet principal de chaque message.">
          {dashboard.intents.length === 0 ? <EmptyState>Pas encore de messages analysés.</EmptyState> : (
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
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Paniers recettes" subtitle="Quand un client demande une recette, Nala propose les ingrédients en un panier.">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-violet-50 p-3 dark:bg-violet-950/20"><p className="text-xs text-violet-700 dark:text-violet-300">Paniers proposés</p><p className="mt-1 text-2xl font-semibold text-violet-950 dark:text-white">{dashboard.cartBuilderProposals}</p></div>
            <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/20"><p className="text-xs text-emerald-700 dark:text-emerald-300">Ajoutés au panier</p><p className="mt-1 text-2xl font-semibold text-emerald-950 dark:text-white">{dashboard.cartBuilderAccepted}</p></div>
          </div>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">Taux d’ajout : <strong className="text-gray-800 dark:text-gray-200">{formatPercent(dashboard.cartBuilderAcceptanceRate)}</strong></p>
        </SectionCard>

        <SectionCard title="Produits proposés par Nala" subtitle="Le produit exact demandé, ou une alternative quand il manque.">
          {dashboard.relationshipTypes.length === 0 ? <EmptyState>Aucun produit proposé sur cette période.</EmptyState> : (
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
      </div>

      <footer className="flex flex-col gap-2 border-t border-[var(--admin-border)] pt-4 text-xs text-gray-400 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-start gap-1.5">
          <IconMessageQuestion size={14} className="mt-0.5 shrink-0" />
          Extraits de messages sans identité du client, e-mails et téléphones masqués. Conversations supprimées après 90 jours.
          Les ventes assistées mesurent une contribution, pas une cause.
        </span>
        <span className="inline-flex items-center gap-1"><IconSparkles size={14} /> Nala Analytics · {dashboard.rangeDays} jours</span>
      </footer>
    </div>
  );
}
