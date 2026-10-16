import { IconAlertTriangle, IconBellOff, IconCircleCheck, IconInbox } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { pageWindow } from '@/lib/admin/listParams';
import { listPlatformTenants, resolvePlatformTenantId } from '@/lib/notifications/platformTenant';
import { BACKFILL_LIST, loadBackfillContext, loadBackfillRows, loadRecentRuns, type BackfillRow, type RunProgress } from '@/lib/notifications/staff/backfill';
import { BACKFILL_MAX_ORDERS } from '@/lib/notifications/staff/backfillPlan';
import AdminStatCard from '../../../../_components/ui/AdminStatCard';
import InlineAlert from '../../../../_components/ui/InlineAlert';
import { Card } from '../../../../_components/ui/Panel';
import { ErrorState } from '../../../../_components/ui/States';
import FilterBar, { type ActiveFilterChip } from '../../../../_components/data/FilterBar';
import Pagination from '../../../../_components/data/Pagination';
import { BackfillWorkspace, RecentRuns } from './BackfillWorkspace';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const PATH = '/admin/platform/notifications/rattrapage';

const NOTIF_VIEWS = [
  { key: 'all', label: 'Toutes' }, { key: 'not_notified', label: 'Sans notification' }, { key: 'failed', label: 'En échec' },
  { key: 'partial', label: 'En partie' }, { key: 'notified', label: 'Déjà notifiées' },
] as const;

// Platform-owner access: app/admin/(protected)/platform/layout.tsx + requirePlatformOwner on every API.
export default async function PlatformNotificationBackfillPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const values = BACKFILL_LIST.parse(searchParams);
  const href = (patch: Parameters<typeof BACKFILL_LIST.href>[2]) => BACKFILL_LIST.href(PATH, values, patch);
  const deployment = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const [tenantId, tenants] = await Promise.all([resolvePlatformTenantId(values.tenant), listPlatformTenants().catch(() => [])]);
  const tenantName = tenants.find((tenant) => tenant.id === tenantId)?.name ?? deployment.name;

  let all: BackfillRow[] = [];
  let capped = false;
  let runs: RunProgress[] = [];
  let whatsapp = { enabled: false, configured: false, recipients: 0 };
  let emailRecipients = 0;
  let failed = false;
  if (tenantId) {
    try {
      const db = createServiceClient();
      const context = await loadBackfillContext(db, tenantId);
      whatsapp = { enabled: context.whatsappEnabled, configured: context.whatsappConfigured, recipients: context.targets.whatsapp.size };
      emailRecipients = context.targets.email.size;
      ({ rows: all, capped } = await loadBackfillRows(db, tenantId, { ...values, notif: 'all' }, context));
      runs = await loadRecentRuns(db, tenantId).catch(() => []);
    } catch (error) {
      console.error('[platform/rattrapage] load failed', error);
      failed = true;
    }
  }

  const count = (state: string) => all.filter((row) => row.state === state).length;
  const rows = values.notif === 'all' ? all : all.filter((row) => row.state === values.notif);
  const window = pageWindow(rows.length, values.page, values.pageSize);
  const pageRows = rows.slice(window.rangeFrom, window.rangeTo + 1);
  const actionable = rows.filter((row) => row.missing > 0 || row.retry > 0).length;

  const chips: ActiveFilterChip[] = [];
  if (values.intl) chips.push({ key: 'intl', label: 'Internationales', href: href({ intl: undefined }) });
  if (values.fresh) chips.push({ key: 'fresh', label: 'Produits frais', href: href({ fresh: undefined }) });

  return (
    <div className="space-y-5">
      <Card>
        <div className="border-b border-a-border p-4">
          <h2 className="text-base font-semibold text-a-text">Rattrapage des commandes · {tenantName}</h2>
          <p className="mt-1 text-sm text-a-text-3">
            Commandes déjà payées et encore à traiter qui n’ont reçu aucune notification « Nouvelle commande » de Lepefy. Rien n’est envoyé sans aperçu puis confirmation ;
            les commandes, paiements et expéditions ne sont jamais modifiés. « Aucune notification Lepefy enregistrée » ne signifie pas que l’équipe n’a pas été prévenue autrement.
          </p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <AdminStatCard title="Commandes ouvertes" value={all.length} icon={IconInbox} href={href({ notif: 'all' })} active={values.notif === 'all'} />
          <AdminStatCard title="Sans notification Lepefy" value={count('not_notified')} tone="warning" icon={IconBellOff} href={href({ notif: 'not_notified' })} active={values.notif === 'not_notified'} />
          <AdminStatCard title="Notification en échec" value={count('failed') + count('partial')} tone="danger" icon={IconAlertTriangle} href={href({ notif: 'failed' })} active={values.notif === 'failed'} />
          <AdminStatCard title="Déjà notifiées" value={count('notified')} tone="success" icon={IconCircleCheck} href={href({ notif: 'notified' })} active={values.notif === 'notified'} />
        </div>
        <div className="space-y-2 px-4 pb-4">
          {emailRecipients === 0 && whatsapp.recipients === 0 && <InlineAlert tone="warning" title="Aucun destinataire">Aucun destinataire actif n’est abonné à « Nouvelle commande » (Paramètres → Notifications du tenant).</InlineAlert>}
          {!whatsapp.enabled && <InlineAlert tone="info">WhatsApp n’est pas activé pour cette boutique : le rattrapage ne peut utiliser que l’email.</InlineAlert>}
          {capped && <InlineAlert tone="warning">Plus de 1 000 commandes correspondent : affinez la période.</InlineAlert>}
        </div>
        <FilterBar
          views={NOTIF_VIEWS.map((view) => ({ key: view.key, label: view.label, href: href({ notif: view.key }), active: values.notif === view.key }))}
          viewsLabel="Notification"
          search={{ placeholder: 'Référence (#A82F19C4) ou nom du client', label: 'Rechercher une commande' }}
          filters={[
            { type: 'select', key: 'tenant', label: 'Boutique', options: tenants.map((tenant) => ({ value: tenant.id, label: `${tenant.name}${tenant.isTest ? ' (test)' : ''}` })), allLabel: deployment.name },
            { type: 'select', key: 'status', label: 'Statut de la commande', options: [{ value: 'new', label: 'Nouvelle' }, { value: 'preparing', label: 'En préparation' }, { value: 'ready_for_pickup', label: 'Prête à retirer' }], allLabel: 'Nouvelles et en préparation' },
            { type: 'select', key: 'payment', label: 'Paiement', options: [{ value: 'stripe', label: 'Carte' }, { value: 'in_store', label: 'En boutique' }, { value: 'external_link', label: 'Paiement externe' }, { value: 'manual', label: 'Enregistré par l’équipe' }], allLabel: 'Tous' },
            { type: 'select', key: 'fulfillment', label: 'Mode', options: [{ value: 'delivery', label: 'Livraison' }, { value: 'pickup', label: 'Retrait' }], allLabel: 'Tous' },
            { type: 'select', key: 'intl', label: 'Destination', options: [{ value: 'true', label: 'Internationales' }, { value: 'false', label: 'Nationales' }], allLabel: 'Toutes' },
            { type: 'select', key: 'fresh', label: 'Produits frais', options: [{ value: 'true', label: 'Avec produits frais' }, { value: 'false', label: 'Sans produits frais' }], allLabel: 'Toutes' },
            { type: 'date-range', label: 'Créées', fromKey: 'from', toKey: 'to' },
          ]}
          activeChips={chips}
          resetHref={PATH}
          resultLabel={`${rows.length} commande${rows.length > 1 ? 's' : ''}`}
        />
        {!tenantId ? <ErrorState title="Boutique introuvable" />
          : failed ? <ErrorState title="Données indisponibles" description="Vérifiez que la migration 158 est appliquée." />
            : (
              <>
                <BackfillWorkspace
                  rows={pageRows}
                  tenantId={tenantId}
                  tenantName={tenantName}
                  filters={Object.fromEntries(Object.entries({ ...values, page: undefined, pageSize: undefined }).filter(([, value]) => value !== undefined && value !== null).map(([key, value]) => [key, String(value)]))}
                  actionableTotal={actionable}
                  maxOrders={BACKFILL_MAX_ORDERS}
                  whatsapp={whatsapp}
                  linkOrders={tenantId === deployment.id}
                />
                <Pagination window={window} noun="commandes" hrefForPage={(page) => href({ page })} hrefForPageSize={(size) => href({ pageSize: size })} pageSizes={BACKFILL_LIST.pageSizes} />
              </>
            )}
      </Card>
      {tenantId && <RecentRuns runs={runs} tenantId={tenantId} />}
    </div>
  );
}
