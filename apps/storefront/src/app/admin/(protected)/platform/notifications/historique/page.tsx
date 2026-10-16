import Link from 'next/link';
import { IconBrandWhatsapp, IconDownload, IconExternalLink, IconMail } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/admin/format';
import { NOTIFICATION_DELIVERY_STATUS_META, statusMeta } from '@/lib/admin/statusRegistry';
import {
  DELIVERY_LIST, DELIVERY_TYPE_LABELS, deliveryResourceHref, loadDeliveryHistory, type DeliveryHistoryRow,
} from '@/lib/notifications/deliveryHistory';
import { greenApiErrorLabel } from '@/lib/notifications/providers/greenApiOutbound';
import { listPlatformTenants, resolvePlatformTenantId } from '@/lib/notifications/platformTenant';
import Badge from '../../../../_components/ui/Badge';
import { buttonClasses } from '../../../../_components/ui/Button';
import { Card } from '../../../../_components/ui/Panel';
import { EmptyState, ErrorState } from '../../../../_components/ui/States';
import DataTable, { type DataColumn } from '../../../../_components/data/DataTable';
import FilterBar from '../../../../_components/data/FilterBar';
import Pagination from '../../../../_components/data/Pagination';
import { DeliveryRetryButton } from './DeliveryRetryButton';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const PATH = '/admin/platform/notifications/historique';
const BREVO_LOGS_URL = 'https://app.brevo.com/transactional/email/logs';

const STATUS_VIEWS = [
  { key: 'all', label: 'Tous' }, { key: 'sent', label: 'Envoyés' }, { key: 'delivered', label: 'Délivrés (WhatsApp)' },
  { key: 'problems', label: 'Échecs' }, { key: 'unknown', label: 'Incertains' }, { key: 'in_progress', label: 'En cours' }, { key: 'skipped', label: 'Non envoyés' },
] as const;

function transportLabel(row: DeliveryHistoryRow) {
  if (row.transport === 'green_api') return 'Green API (WhatsApp Lepefy)';
  if (row.transport === 'brevo') return 'Brevo API';
  if (row.transport === 'n8n') return 'n8n';
  return '—';
}

function errorText(row: DeliveryHistoryRow) {
  if (!row.last_error || row.status === 'accepted' || row.status === 'delivered') return null;
  return greenApiErrorLabel(row.last_error) ?? row.last_error;
}

// Platform-owner access is enforced by app/admin/(protected)/platform/layout.tsx
// and by the platform API routes (requirePlatformOwner).
export default async function PlatformNotificationHistoryPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const values = DELIVERY_LIST.parse(searchParams);
  const href = (patch: Parameters<typeof DELIVERY_LIST.href>[2]) => DELIVERY_LIST.href(PATH, values, patch);
  const [tenantId, tenants] = await Promise.all([resolvePlatformTenantId(values.tenant), listPlatformTenants().catch(() => [])]);

  let result: Awaited<ReturnType<typeof loadDeliveryHistory>> | null = null;
  let failed = false;
  if (tenantId) {
    try { result = await loadDeliveryHistory(createServiceClient(), tenantId, values); } catch (error) {
      console.error('[platform/historique] load failed', error);
      failed = true;
    }
  }

  const columns: DataColumn<DeliveryHistoryRow>[] = [
    { key: 'status', header: 'Statut', cell: (row) => { const meta = statusMeta(NOTIFICATION_DELIVERY_STATUS_META, row.status); return <Badge tone={meta.tone} dot>{meta.label}</Badge>; } },
    { key: 'date', header: 'Date', cell: (row) => <span className="whitespace-nowrap text-a-text-2">{formatDate(row.created_at, 'datetime')}</span> },
    { key: 'channel', header: 'Canal', cell: (row) => (
      <span className="inline-flex items-center gap-1 text-a-text-2">{row.channel === 'whatsapp' ? <IconBrandWhatsapp size={16} aria-hidden="true" /> : <IconMail size={16} aria-hidden="true" />}{row.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
    ) },
    { key: 'type', header: 'Type', cell: (row) => <span className="text-a-text-2">{DELIVERY_TYPE_LABELS[row.notification_type] ?? row.notification_type}{row.event?.source === 'backfill' && <Badge tone="neutral" className="ml-1">Rattrapage</Badge>}</span> },
    { key: 'subject', header: 'Objet', className: 'max-w-[280px]', cell: (row) => <span className="line-clamp-2 text-a-text">{row.subject ?? '—'}</span> },
    { key: 'recipient', header: 'Destinataire', hideBelow: 'lg', cell: (row) => <span className="text-a-text-2">{row.recipients[0] ?? '—'}{row.recipients.length > 1 && <span className="ml-1 text-xs text-a-text-3">+{row.recipients.length - 1}</span>}</span> },
    { key: 'attempts', header: 'Essais', align: 'center', cell: (row) => <span className="tabular-nums text-a-text-2">{row.attempts}/{row.max_attempts}</span> },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', cell: (row) => (
      (row.status === 'failed' || row.status === 'dead' || row.status === 'unknown') && row.retryable
        ? <DeliveryRetryButton id={row.id} tenantId={tenantId!} uncertain={row.status === 'unknown'} /> : null
    ) },
  ];

  const detail = (row: DeliveryHistoryRow) => {
    const resource = deliveryResourceHref(row.event);
    const error = errorText(row);
    return (
      <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-a-text-3">Destinataires</dt><dd className="break-words text-a-text">{row.recipients.join(', ') || '—'}</dd></div>
        <div><dt className="text-a-text-3">Transport</dt><dd className="text-a-text">{transportLabel(row)}</dd></div>
        <div>
          <dt className="text-a-text-3">ID message</dt>
          <dd className="flex flex-wrap items-center gap-2 text-a-text">
            <span className="select-all break-all font-mono">{row.provider_message_id ?? '—'}</span>
            {row.provider_message_id && row.transport === 'brevo' && <a href={BREVO_LOGS_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-a-brand-fg hover:underline">Logs Brevo <IconExternalLink size={13} aria-hidden="true" /></a>}
          </dd>
        </div>
        <div><dt className="text-a-text-3">Accepté le</dt><dd className="text-a-text">{row.accepted_at ? formatDate(row.accepted_at, 'datetime') : '—'}</dd></div>
        {row.channel === 'whatsapp' && <div><dt className="text-a-text-3">Statut observé (WhatsApp)</dt><dd className="text-a-text">{row.provider_status ?? (row.status === 'accepted' ? 'en attente de confirmation' : '—')}{row.delivered_at ? ` · ${formatDate(row.delivered_at, 'datetime')}` : ''}</dd></div>}
        {row.status === 'failed' && <div><dt className="text-a-text-3">Prochain essai</dt><dd className="text-tone-warning-fg">{formatDate(row.next_attempt_at, 'datetime')}</dd></div>}
        {resource && <div><dt className="text-a-text-3">Ressource</dt><dd><Link href={resource} className="font-medium text-a-brand-fg hover:underline">Ouvrir</Link></dd></div>}
        {error && <div className="sm:col-span-2 lg:col-span-3"><dt className="text-a-text-3">Erreur</dt><dd className="break-words font-mono text-tone-danger-fg">{error}</dd></div>}
        {row.status === 'unknown' && <div className="sm:col-span-2 lg:col-span-3 text-tone-urgent-fg">Le message a peut-être été reçu : vérifiez avec le destinataire avant de relancer.</div>}
        {!row.retryable && !['accepted', 'delivered', 'skipped'].includes(row.status) && (
          <div className="sm:col-span-2 lg:col-span-3 text-a-text-3">Envoi journalisé uniquement : les nouveaux essais sont gérés par le module d’origine.</div>
        )}
      </dl>
    );
  };

  const exportQuery = DELIVERY_LIST.query({ ...values, page: 1 });

  return (
    <Card>
      <div className="flex flex-col gap-2 border-b border-a-border p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-a-text">Historique des envois</h2>
          <p className="mt-1 text-sm text-a-text-3">Emails et WhatsApp automatiques du tenant, avec transport, identifiants et erreurs techniques. Réservé au support plateforme.</p>
        </div>
        <a href={`/api/admin/platform/notification-deliveries?format=csv${exportQuery ? `&${exportQuery}` : ''}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          <IconDownload size={16} aria-hidden="true" />Exporter CSV
        </a>
      </div>
      <FilterBar
        views={STATUS_VIEWS.map((view) => ({ key: view.key, label: view.label, href: href({ status: view.key }), active: values.status === view.key }))}
        viewsLabel="Statut"
        search={{ placeholder: 'Objet, type, erreur, ID…', label: 'Rechercher un envoi' }}
        filters={[
          { type: 'select', key: 'tenant', label: 'Boutique', options: tenants.map((tenant) => ({ value: tenant.id, label: `${tenant.name}${tenant.isTest ? ' (test)' : ''}` })), allLabel: 'Boutique du déploiement' },
          { type: 'select', key: 'channel', label: 'Canal', options: [{ value: 'email', label: 'Email' }, { value: 'whatsapp', label: 'WhatsApp' }], allLabel: 'Tous les canaux' },
          { type: 'date-range', label: 'Période', fromKey: 'from', toKey: 'to' },
        ]}
        resetHref={PATH}
        resultLabel={result ? `${result.window.total} envoi${result.window.total > 1 ? 's' : ''}` : undefined}
      />
      {!tenantId ? <ErrorState title="Boutique introuvable" description="Choisissez une autre boutique." />
        : failed ? <ErrorState title="Historique indisponible" description="Vérifiez que les migrations 136 et 158 sont appliquées." />
          : (
            <>
              <DataTable caption="Historique des envois" columns={columns} rows={result?.rows ?? []} rowKey={(row) => row.id}
                rowTone={(row) => statusMeta(NOTIFICATION_DELIVERY_STATUS_META, row.status).tone === 'danger' ? 'danger' : row.status === 'unknown' ? 'urgent' : undefined}
                rowDetail={detail} density="compact"
                empty={<EmptyState variant={DELIVERY_LIST.activeCount(values) > 0 || values.q ? 'filtered' : 'empty'} title="Aucun envoi pour ces critères" />} />
              {result && <Pagination window={result.window} noun="envois" hrefForPage={(page) => href({ page })} hrefForPageSize={(size) => href({ pageSize: size })} pageSizes={DELIVERY_LIST.pageSizes} />}
            </>
          )}
    </Card>
  );
}
