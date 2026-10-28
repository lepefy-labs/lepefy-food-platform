import { IconExternalLink } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/admin/format';
import {
  ANALYTICS_LIST, categoryDistribution, computeKpis, dailySeries, failureDistribution, loadAnalytics, matchesEventFilter,
  messageStatus, paginate, FAILURE_LABELS, type EnrichedMessage, type MessageStatus, type Rate,
} from '@/lib/notifications/brevoAnalytics';
import { EMAIL_CATEGORIES, EMAIL_CATEGORY_LABELS } from '@/lib/notifications/brevoEvents';
import { listPlatformTenants } from '@/lib/notifications/platformTenant';
import AdminStatCard from '../../../../_components/ui/AdminStatCard';
import Badge from '../../../../_components/ui/Badge';
import { Card } from '../../../../_components/ui/Panel';
import { EmptyState, ErrorState } from '../../../../_components/ui/States';
import DataTable, { type DataColumn } from '../../../../_components/data/DataTable';
import FilterBar from '../../../../_components/data/FilterBar';
import Pagination from '../../../../_components/data/Pagination';
import { BarList, TrendChart } from './EmailCharts';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/platform/notifications/email-analytics';

const STATUS_BADGE: Record<MessageStatus, { label: string; tone: 'success' | 'danger' | 'warning' | 'info' | 'neutral' }> = {
  delivered: { label: 'Délivré', tone: 'success' },
  sent: { label: 'Envoyé', tone: 'info' },
  deferred: { label: 'Différé', tone: 'warning' },
  failed: { label: 'Non délivré', tone: 'danger' },
  error: { label: 'Erreur', tone: 'danger' },
  unknown: { label: 'Envoi non confirmé', tone: 'neutral' },
};

const EVENT_OPTIONS = [
  { value: 'delivered', label: 'Délivrés' }, { value: 'opened', label: 'Avec ouverture' }, { value: 'no_open', label: 'Délivrés sans ouverture' },
  { value: 'clicked', label: 'Avec clic' }, { value: 'failed', label: 'Non délivrés' }, { value: 'error', label: 'Avec erreur' },
];

const nf = new Intl.NumberFormat('fr-FR');
const pct = (rate: Rate) => (rate.value === null ? 'n.d.' : `${(rate.value * 100).toFixed(1).replace('.', ',')} %`);
const countText = (value: number, tracked: number) => (tracked === 0 ? 'n.d.' : nf.format(value));

function duration(seconds: number | null) {
  if (seconds === null) return 'n.d.';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  if (seconds < 172_800) return `${(seconds / 3600).toFixed(1).replace('.', ',')} h`;
  return `${Math.round(seconds / 86_400)} j`;
}

const OPEN_LABEL = { human_likely: 'Oui', suspicious: 'Probable robot', proxy_only: 'Proxy seulement', none: '—' } as const;

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx
// (this page reads with the service role only after that check).
export default async function PlatformEmailAnalyticsPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const values = ANALYTICS_LIST.parse(searchParams);
  const href = (patch: Parameters<typeof ANALYTICS_LIST.href>[2]) => ANALYTICS_LIST.href(PATH, values, patch);

  let data: Awaited<ReturnType<typeof loadAnalytics>> | null = null;
  let failed = false;
  const tenants = await listPlatformTenants().catch(() => []);
  try { data = await loadAnalytics(createServiceClient(), values); } catch (error) {
    console.error('[platform/email-analytics] load failed', (error as { message?: string } | null)?.message ?? 'unknown');
    failed = true;
  }

  if (failed || !data) {
    return <ErrorState title="Statistiques indisponibles" description="Vérifiez que la migration 170 est appliquée et que le webhook Brevo est configuré (docs/BREVO_EMAIL_ANALYTICS.md)." />;
  }

  const tenantName = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));
  const kpis = computeKpis(data.rows);
  const t = kpis.tracked.messages;
  const series = dailySeries(data.rows, data.period.fromDay, data.period.toDay);
  const categories = categoryDistribution(data.rows);
  const failures = failureDistribution(data.rows);
  const tableRows = data.rows.filter((row) => matchesEventFilter(row, values.event));
  const { rows: pageRows, window } = paginate(tableRows, values);
  const filtered = ANALYTICS_LIST.activeCount(values, ['tenant', 'category', 'event', 'from', 'to']) > 0;
  const unattributed = data.rows.filter((row) => row.tenant_id === null).length;

  const rangeViews = [{ key: '7', label: '7 jours' }, { key: '30', label: '30 jours' }, { key: '90', label: '90 jours' }].map((view) => ({
    key: view.key, label: view.label, href: href({ range: view.key, from: undefined, to: undefined }), active: !values.from && values.range === view.key,
  }));

  const columns: DataColumn<EnrichedMessage>[] = [
    { key: 'date', header: 'Date', cell: (row) => <span className="whitespace-nowrap text-a-text-2">{formatDate(row.sent_at ?? row.first_event_at, 'datetime')}{!row.sent_at && <span className="block text-xs text-a-text-3">envoi non enregistré</span>}</span> },
    { key: 'tenant', header: 'Boutique', cell: (row) => row.tenant_id ? <span className="text-a-text">{tenantName.get(row.tenant_id) ?? '—'}</span> : <span className="text-a-text-3">Non attribué</span> },
    { key: 'category', header: 'Catégorie', cell: (row) => <span className="text-a-text-2">{EMAIL_CATEGORY_LABELS[row.category]}</span> },
    { key: 'subject', header: 'Objet', className: 'max-w-[260px]', hideBelow: 'md', cell: (row) => <span className="line-clamp-2 text-a-text">{row.subject ?? '—'}</span> },
    { key: 'status', header: 'État', cell: (row) => { const meta = STATUS_BADGE[messageStatus(row)]; return <Badge tone={meta.tone} dot>{meta.label}</Badge>; } },
    { key: 'open', header: 'Première ouverture', hideBelow: 'sm', cell: (row) => (
      <span className="text-a-text-2">{OPEN_LABEL[row.openKind]}{row.first_open_at && <span className="block text-xs text-a-text-3">{formatDate(row.first_open_at, 'datetime')}</span>}</span>
    ) },
    { key: 'click', header: 'Clic', align: 'center', hideBelow: 'sm', cell: (row) => <span className="tabular-nums text-a-text-2">{row.clicked ? `Oui · ${row.click_events}` : '—'}</span> },
    { key: 'error', header: 'Erreur', hideBelow: 'lg', className: 'max-w-[220px]', cell: (row) => (
      row.failure_event || row.has_error
        ? <span className="text-xs text-tone-danger-fg">{FAILURE_LABELS[row.failure_event ?? 'error']}{row.reason && <span className="block break-words text-a-text-3">{row.reason}</span>}</span>
        : <span className="text-a-text-3">—</span>
    ) },
    { key: 'recipient', header: 'Destinataire', hideBelow: 'xl', cell: (row) => <span className="font-mono text-xs text-a-text-3">{row.recipient_masked ?? '—'}</span> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-a-text">Email Analytics</h1>
        <p className="mt-1 text-sm text-a-text-3">
          Événements Brevo des emails transactionnels Lepefy Food, du {data.period.fromDay} au {data.period.toDay} (heure de Paris).
          Une ouverture enregistrée ne prouve pas une lecture humaine : les pixels sont chargés par les antivirus, les prévisualisations et la protection de confidentialité d’Apple.
        </p>
      </div>

      <Card>
        <FilterBar
          views={rangeViews}
          viewsLabel="Période"
          filters={[
            { type: 'date-range', label: 'Intervalle personnalisé', fromKey: 'from', toKey: 'to' },
            { type: 'select', key: 'tenant', label: 'Boutique', options: tenants.map((tenant) => ({ value: tenant.id, label: `${tenant.name}${tenant.isTest ? ' (test)' : ''}` })), allLabel: 'Toutes les boutiques' },
            { type: 'select', key: 'category', label: 'Catégorie', options: EMAIL_CATEGORIES.map((category) => ({ value: category, label: EMAIL_CATEGORY_LABELS[category] })), allLabel: 'Toutes les catégories' },
            { type: 'select', key: 'event', label: 'Événement (tableau)', options: EVENT_OPTIONS, allLabel: 'Tous les événements' },
          ]}
          resetHref={PATH}
          resultLabel={`${nf.format(t)} message${t > 1 ? 's' : ''} suivi${t > 1 ? 's' : ''}`}
        />
      </Card>

      {data.truncated && <p role="status" className="rounded-lg border border-tone-warning-border bg-tone-warning-bg px-4 py-2 text-sm text-tone-warning-fg">Plus de {nf.format(30_000)} messages sur la période : seuls les plus récents sont comptés. Réduisez la période.</p>}

      {data.firstEventEver === null ? (
        <Card>
          <EmptyState title="Aucun événement Brevo reçu" description={<>Le suivi démarre à la réception du premier événement. Configurez le webhook Brevo (voir docs/BREVO_EMAIL_ANALYTICS.md) : les emails envoyés avant l’activation ne seront jamais suivis.</>} />
        </Card>
      ) : (
        <>
          <section aria-label="Indicateurs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <AdminStatCard title="Emails suivis" tone="brand" value={nf.format(t)} description={`${nf.format(kpis.tracked.recipients)} destinataire${kpis.tracked.recipients > 1 ? 's' : ''} distinct${kpis.tracked.recipients > 1 ? 's' : ''}`} />
            <AdminStatCard title="Délivrés" tone="success" value={countText(kpis.delivered.messages, t)} description={`${nf.format(kpis.delivered.recipients)} destinataires · taux ${pct(kpis.deliveryRate)} (sur ${nf.format(kpis.deliveryRate.denominator)} suivis)`} />
            <AdminStatCard title="Première ouverture" tone="info" value={countText(kpis.firstOpen.messages, kpis.delivered.messages)} description={`${nf.format(kpis.firstOpen.recipients)} destinataires · taux ${pct(kpis.firstOpenRate)} (sur ${nf.format(kpis.firstOpenRate.denominator)} délivrés)`} />
            <AdminStatCard title="Avec clic" tone="info" value={countText(kpis.clicked.messages, kpis.delivered.messages)} description={`${nf.format(kpis.clicked.recipients)} destinataires · taux ${pct(kpis.clickRate)} (sur ${nf.format(kpis.clickRate.denominator)} délivrés)`} />
            <AdminStatCard title="Non délivrés" tone={kpis.undelivered.messages > 0 ? 'danger' : 'neutral'} value={countText(kpis.undelivered.messages, t)} description={`${nf.format(kpis.undelivered.recipients)} destinataires · ${nf.format(kpis.errors.messages)} erreur${kpis.errors.messages > 1 ? 's' : ''} d’envoi`} />
          </section>
          <p className="text-xs text-a-text-3">
            Délai médian entre livraison et première ouverture : <strong className="text-a-text-2">{duration(kpis.medianOpenDelaySeconds)}</strong>
            {kpis.medianOpenSample > 0 && <> (sur {nf.format(kpis.medianOpenSample)} message{kpis.medianOpenSample > 1 ? 's' : ''}, ouvertures automatiques exclues)</>}.
            {' '}Ouvertures probablement automatiques (moins de 3 s après la livraison) : {nf.format(kpis.suspiciousOpens)} · messages ouverts uniquement via proxy (non comptés comme ouverture) : {nf.format(kpis.proxyOnly)}.
            {' '}« n.d. » = non disponible, pas zéro.
          </p>
          {data.coverage && data.coverage.accepted > 0 && data.coverage.tracked < data.coverage.accepted && (
            <p className="text-xs text-a-text-3">
              Couverture : {nf.format(data.coverage.tracked)} email{data.coverage.tracked > 1 ? 's' : ''} suivi{data.coverage.tracked > 1 ? 's' : ''} sur {nf.format(data.coverage.accepted)} accepté{data.coverage.accepted > 1 ? 's' : ''} par Brevo pendant la période : les autres ont été envoyés avant l’activation du webhook ou n’ont pas encore d’événement.
            </p>
          )}
          {unattributed > 0 && (
            <p className="text-xs text-a-text-3">{nf.format(unattributed)} message{unattributed > 1 ? 's' : ''} sans boutique identifiable (identifiant absent de l’historique des envois) : comptés au total, exclus dès qu’une boutique est choisie.</p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-3 text-base font-semibold text-a-text">Envoyés et délivrés par jour</h2>
              <TrendChart points={series} label="Emails envoyés et délivrés par jour"
                series={[{ key: 'sent', label: 'Envoyés', color: '#6366f1' }, { key: 'delivered', label: 'Délivrés', color: '#059669' }]} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-base font-semibold text-a-text">Premières ouvertures et clics par jour</h2>
              <TrendChart points={series} label="Premières ouvertures et clics par jour"
                series={[{ key: 'firstOpen', label: 'Premières ouvertures', color: '#0ea5e9' }, { key: 'clicked', label: 'Clics', color: '#d97706' }]} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-base font-semibold text-a-text">Répartition par catégorie</h2>
              <BarList color="#6366f1" empty="Aucun message sur la période." items={categories.map((item) => ({ label: EMAIL_CATEGORY_LABELS[item.category], value: item.messages }))} />
            </Card>
            <Card className="p-5">
              <h2 className="mb-3 text-base font-semibold text-a-text">Erreurs de livraison par type</h2>
              <BarList color="#dc2626" empty="Aucune erreur de livraison sur la période." items={failures.map((item) => ({ label: item.label, value: item.messages }))} />
            </Card>
          </div>

          <Card>
            <div className="border-b border-a-border p-4">
              <h2 className="text-base font-semibold text-a-text">Messages</h2>
              <p className="mt-1 text-sm text-a-text-3">Un message par destinataire. Adresses masquées ; objet issu de l’historique des envois.
                <a href="https://app.brevo.com/transactional/email/logs" target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 font-medium text-a-brand-fg hover:underline">Logs Brevo <IconExternalLink size={13} aria-hidden="true" /></a>
              </p>
            </div>
            <DataTable caption="Messages Brevo suivis" columns={columns} rows={pageRows} rowKey={(row) => `${row.message_id}:${row.recipient_hash}`} density="compact"
              rowTone={(row) => (row.undelivered || row.has_error ? 'danger' : undefined)}
              empty={<EmptyState variant={filtered ? 'filtered' : 'empty'} title="Aucun message pour ces critères" />} />
            <Pagination window={window} noun="messages" hrefForPage={(page) => href({ page })} hrefForPageSize={(size) => href({ pageSize: size })} pageSizes={ANALYTICS_LIST.pageSizes} />
          </Card>
        </>
      )}
    </div>
  );
}
