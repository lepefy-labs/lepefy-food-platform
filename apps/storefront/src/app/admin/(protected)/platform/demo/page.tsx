import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { demoAccessMode, demoKeyMismatch, isDemoActive, isDemoDeployment } from '@/lib/demo/demoEnvironment';
import { DEMO_INTEREST_LABELS, type DemoInterest } from '@/lib/demo/demoRequest';
import { formatDate, formatNumber } from '@/lib/admin/format';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import AdminStatCard from '../../../_components/ui/AdminStatCard';
import Badge from '../../../_components/ui/Badge';
import InlineAlert from '../../../_components/ui/InlineAlert';
import { Panel } from '../../../_components/ui/Panel';
import { EmptyState } from '../../../_components/ui/States';
import PlatformSectionTabs from '../../../_components/PlatformSectionTabs';
import { AccessLinkForm, PresentationControls, RequestActions } from './DemoConsoleClient';

export const dynamic = 'force-dynamic';

const RESET_WORKFLOW_URL = 'https://github.com/lepefy-labs/lepefy-food-platform/actions/workflows/demo-reset.yml';
const REQUEST_STATUS = { new: { label: 'Nouvelle', tone: 'info' }, contacted: { label: 'Contactée', tone: 'success' }, closed: { label: 'Close', tone: 'neutral' } } as const;
const EVENT_LABELS: Record<string, string> = {
  'landing.view': 'Pages d’accueil vues', 'visit.started': 'Visites admin ouvertes', 'tour.completed': 'Visites guidées terminées',
  'request.opened': 'Formulaires ouverts', 'request.sent': 'Demandes envoyées', 'path.shop': 'Parcours boutique',
  'path.events': 'Parcours événements', 'path.orders': 'Parcours commandes', 'path.management': 'Parcours gestion', 'path.nala': 'Parcours Nala',
};

interface DemoRequestRow {
  id: string; business_name: string; city: string | null; contact_email: string | null; contact_phone: string | null;
  message: string | null; interests: string[]; status: keyof typeof REQUEST_STATUS; handled_note: string | null; created_at: string;
}

export default async function PlatformDemoPage({ searchParams }: { searchParams: { statut?: string } }) {
  if (await requirePlatformOwner()) redirect('/admin');
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const active = isDemoActive(tenant);
  const header = (
    <AdminPageHeader
      title="Démo"
      description="Présentation en cours, remise à zéro, demandes « Demander ma propre boutique » et fréquentation agrégée."
      breadcrumb={[{ label: 'Console Lepefy', href: '/admin/platform' }, { label: 'Démo' }]}
      tabs={<PlatformSectionTabs groupId="development" />}
    />
  );

  if (!active) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <InlineAlert tone={demoKeyMismatch(tenant) ? 'warning' : 'info'} title={demoKeyMismatch(tenant) ? 'Configuration de démo incomplète' : 'Ce déploiement n’est pas une démo'}>
          {demoKeyMismatch(tenant)
            ? (isDemoDeployment()
              ? 'La variable LEPEFY_DEPLOYMENT_KIND=demo est posée mais ce tenant n’est pas un tenant de démo : les fonctions de démo restent fermées.'
              : 'Ce tenant est marqué démo mais le déploiement ne l’est pas : les fonctions de démo restent fermées.')
            : 'La console démo s’utilise sur le déploiement de démonstration (projet Vercel lepefy-demo, base Supabase séparée). Voir docs/DEMO_EXPERIENCE.md.'}
        </InlineAlert>
      </div>
    );
  }

  const db = createServiceClient();
  const status = searchParams.statut === 'all' || searchParams.statut === 'contacted' || searchParams.statut === 'closed' ? searchParams.statut : 'new';
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10);
  const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
  let requestsQuery = db.from('demo_requests')
    .select('id, business_name, city, contact_email, contact_phone, message, interests, status, handled_note, created_at')
    .order('created_at', { ascending: false }).limit(50);
  if (status !== 'all') requestsQuery = requestsQuery.eq('status', status);

  const [presentation, resets, requests, newCount, counts, messagesToday, aiToday] = await Promise.all([
    db.from('demo_presentations').select('started_by, started_at, expires_at').is('ended_at', null).gt('expires_at', new Date().toISOString()).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('demo_resets').select('scenario, requested_by, status, started_at, finished_at, detail').order('started_at', { ascending: false }).limit(5),
    requestsQuery,
    db.from('demo_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('demo_event_counts').select('event_key, count').gte('day', since),
    db.from('demo_simulated_messages').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', startOfDay.toISOString()),
    db.from('ai_usage_log').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id).gte('created_at', startOfDay.toISOString()),
  ]);

  const totals = new Map<string, number>();
  for (const row of (counts.data ?? []) as Array<{ event_key: string; count: number }>) totals.set(row.event_key, (totals.get(row.event_key) ?? 0) + row.count);
  const lastReset = (resets.data ?? [])[0] as { status: string; finished_at: string | null; started_at: string } | undefined;
  const aiLimit = tenant.ai_rate_limit_public_per_day ?? null;
  const live = presentation.data as { started_by: string; started_at: string; expires_at: string } | null;
  const rows = (requests.data ?? []) as DemoRequestRow[];

  return (
    <div className="flex flex-col gap-6">
      {header}

      <Panel
        title="Présentation"
        description="Pendant une présentation, la remise à zéro (nocturne ou manuelle) est refusée : l’écran ne change pas devant le prospect."
        actions={<PresentationControls active={Boolean(live)} />}
      >
        {live ? (
          <p className="text-sm text-a-text">
            <Badge tone="success" dot>En cours</Badge>{' '}
            par {live.started_by}, jusqu’à {formatDate(live.expires_at, 'time', 'Europe/Paris')}.
          </p>
        ) : (
          <p className="text-sm text-a-text-2">Aucune présentation en cours.</p>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard title="Dernière remise à zéro" value={lastReset ? formatDate(lastReset.finished_at ?? lastReset.started_at, 'short', 'Europe/Paris') : '—'} description={lastReset ? (lastReset.status === 'done' ? 'Réussie' : lastReset.status === 'running' ? 'En cours' : 'Échouée') : 'Jamais'} tone={lastReset?.status === 'failed' ? 'danger' : 'neutral'} />
        <AdminStatCard title="Demandes à traiter" value={newCount.count ?? 0} tone={(newCount.count ?? 0) > 0 ? 'info' : 'neutral'} />
        <AdminStatCard title="Messages simulés aujourd’hui" value={messagesToday.count ?? 0} />
        <AdminStatCard title="Appels IA aujourd’hui" value={formatNumber(aiToday.count ?? 0)} description={aiLimit ? `Plafond du tenant : ${formatNumber(aiLimit)} par jour` : undefined} />
      </div>

      <Panel
        title="Remise à zéro"
        description="Crée un nouveau tenant de démo à partir du scénario et archive l’ancien. Chaque nuit à 4 h (Paris) sauf présentation en cours ; à la demande depuis GitHub Actions."
        actions={<a href={RESET_WORKFLOW_URL} target="_blank" rel="noreferrer" className="text-sm font-semibold text-a-brand-fg underline underline-offset-2">Ouvrir le workflow</a>}
        flush
      >
        {(resets.data ?? []).length === 0 ? (
          <EmptyState title="Aucune remise à zéro enregistrée" description="Lancez le workflow « Demo reset » une première fois." />
        ) : (
          <ul className="divide-y divide-a-border">
            {((resets.data ?? []) as Array<{ scenario: string; requested_by: string; status: string; started_at: string; detail: string | null }>).map((reset) => (
              <li key={reset.started_at} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
                <Badge tone={reset.status === 'done' ? 'success' : reset.status === 'running' ? 'info' : 'danger'}>{reset.status === 'done' ? 'Réussie' : reset.status === 'running' ? 'En cours' : 'Échouée'}</Badge>
                <span className="text-a-text">{reset.scenario}</span>
                <span className="text-a-text-3">· {reset.requested_by} · {formatDate(reset.started_at, 'datetime', 'Europe/Paris')}</span>
                {reset.detail && <span className="w-full text-a-text-3">{reset.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {demoAccessMode() === 'private' && (
        <Panel title="Lien d’accès privé" description="Cette démo est privée : chaque page demande un lien signé. Le lien expire au plus tard après 7 jours.">
          <AccessLinkForm />
        </Panel>
      )}

      <Panel
        title="Demandes « Demander ma propre boutique »"
        description="Coordonnées laissées avec consentement, pour recontacter la personne. Aucun e-mail automatique n’est envoyé."
        actions={
          <nav aria-label="Filtrer les demandes" className="flex flex-wrap gap-1 text-sm">
            {(['new', 'contacted', 'closed', 'all'] as const).map((value) => (
              <Link key={value} href={value === 'new' ? '/admin/platform/demo' : `/admin/platform/demo?statut=${value}`}
                aria-current={status === value ? 'page' : undefined}
                className={`rounded-md px-2.5 py-1 font-semibold ${status === value ? 'bg-a-brand-soft text-a-brand-fg' : 'text-a-text-2 hover:bg-a-hover'}`}>
                {value === 'all' ? 'Toutes' : `${REQUEST_STATUS[value].label}s`}
              </Link>
            ))}
          </nav>
        }
        flush
      >
        {rows.length === 0 ? (
          <EmptyState title="Aucune demande" description="Les demandes envoyées depuis la page d’accueil de la démo apparaissent ici." />
        ) : (
          <ul className="divide-y divide-a-border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-a-text">{row.business_name}</span>
                  {row.city && <span className="text-a-text-2">· {row.city}</span>}
                  <Badge tone={REQUEST_STATUS[row.status].tone}>{REQUEST_STATUS[row.status].label}</Badge>
                  <span className="ml-auto text-a-text-3">{formatDate(row.created_at, 'datetime', 'Europe/Paris')}</span>
                </div>
                <p className="text-a-text-2">{[row.contact_email, row.contact_phone].filter(Boolean).join(' · ')}</p>
                {row.interests.length > 0 && <p className="text-a-text-3">Intérêts : {row.interests.map((value) => DEMO_INTEREST_LABELS[value as DemoInterest] ?? value).join(', ')}</p>}
                {row.message && <p className="whitespace-pre-line text-a-text">{row.message}</p>}
                <RequestActions id={row.id} status={row.status} note={row.handled_note} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Fréquentation (7 jours)" description="Compteurs agrégés par jour et par évènement : aucune donnée personnelle, aucun identifiant de visiteur." flush>
        <dl className="grid grid-cols-1 divide-y divide-a-border sm:grid-cols-2 sm:divide-y-0">
          {Object.entries(EVENT_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between px-4 py-2 text-sm">
              <dt className="text-a-text-2">{label}</dt>
              <dd className="font-semibold tabular-nums text-a-text">{formatNumber(totals.get(key) ?? 0)}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}
