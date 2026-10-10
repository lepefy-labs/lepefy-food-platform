import Link from 'next/link';
import { IconBrandWhatsapp, IconMessages, IconRobot } from '@tabler/icons-react';
import { createServiceClient } from '@/lib/supabase/server';
import { loadLiveChannel } from '@/lib/whatsapp/adminQueries';
import { toChannelView } from '@/lib/whatsapp/adminSchemas';
import { resolveChannelAccessToken } from '@/lib/whatsapp/provider/credentials';
import { requireWhatsAppPage } from '@/lib/whatsapp/server/featureGate';
import AdminPageHeader from '../../../_components/ui/AdminPageHeader';
import ChannelSettingsPanel from './_components/ChannelSettingsPanel';
import ChannelIdentityPanel from './_components/ChannelIdentityPanel';
import WhatsAppTabs from './_components/WhatsAppTabs';
import { loadNeedsHumanCount } from './_components/loadNeedsHumanCount';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const STATUS_LABEL = { pending: 'En test (sans automatisation)', active: 'Actif', disabled: 'Désactivé' } as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-a-border py-2.5 last:border-0">
      <dt className="text-sm text-a-text-3">{label}</dt>
      <dd className="text-right text-sm font-medium text-a-text">{children}</dd>
    </div>
  );
}

function OnOff({ value }: { value: boolean }) {
  return <span className={value ? 'text-tone-success-fg' : 'text-a-text-3'}>{value ? 'Activé' : 'Désactivé'}</span>;
}

export default async function WhatsAppOverviewPage() {
  const { tenant, access, can } = await requireWhatsAppPage('whatsapp.view');
  const [channel, needsHuman] = await Promise.all([
    loadLiveChannel(createServiceClient(), tenant.id),
    loadNeedsHumanCount(tenant.id),
  ]);
  const view = channel ? toChannelView(channel, { isPlatformOwner: access.isPlatformOwner, tokenConfigured: Boolean(resolveChannelAccessToken(channel)) }) : null;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  return (
    <div className="mx-auto max-w-5xl">
      <AdminPageHeader title="WhatsApp" description="Le numéro WhatsApp Business de la boutique : réponses automatiques, Nala et reprise par l’équipe." />
      <WhatsAppTabs active="overview" needsHumanCount={needsHuman} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-a-border bg-a-surface p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <IconBrandWhatsapp size={20} className="text-tone-success-fg" aria-hidden="true" />
            <h2 className="text-base font-semibold text-a-text">Canal</h2>
          </div>
          {view ? (
            <dl>
              <Row label="Statut">{STATUS_LABEL[view.status]}{view.environment === 'test' ? ' · numéro de test Meta' : ''}</Row>
              <Row label="Numéro">{view.displayPhoneNumber ?? '—'}</Row>
              <Row label="Nom vérifié">{view.verifiedName ?? '—'}</Row>
              <Row label="Automatisations"><OnOff value={view.automationEnabled} /></Row>
              <Row label="Nala"><OnOff value={view.aiEnabled} /></Row>
              <Row label="Passage à un opérateur"><OnOff value={view.humanHandoffEnabled} /></Row>
              <Row label="Connexion Meta">{view.tokenConfigured ? 'Jeton serveur configuré' : <span className="text-tone-warning-fg">Jeton serveur manquant</span>}</Row>
            </dl>
          ) : (
            <div className="rounded-xl border border-dashed border-a-border px-4 py-6 text-center text-sm text-a-text-3">
              Non configuré. La connexion d’un numéro est réalisée par l’équipe Lepefy.
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/admin/canaux/whatsapp/conversations" className="inline-flex items-center gap-2 rounded-lg border border-a-border px-3 py-2 text-sm font-medium text-a-text-2 hover:bg-a-surface-2">
              <IconMessages size={16} aria-hidden="true" /> Conversations{needsHuman > 0 ? ` (${needsHuman} en attente)` : ''}
            </Link>
            <Link href="/admin/canaux/whatsapp/automatisations" className="inline-flex items-center gap-2 rounded-lg border border-a-border px-3 py-2 text-sm font-medium text-a-text-2 hover:bg-a-surface-2">
              <IconRobot size={16} aria-hidden="true" /> Automatisations
            </Link>
          </div>
        </section>

        {view && view.status !== 'disabled' && (
          <ChannelSettingsPanel initial={view} canManage={can('whatsapp.manage')} />
        )}
      </div>

      {access.isPlatformOwner && (
        <ChannelIdentityPanel
          initial={view}
          webhookUrl={appUrl ? `${appUrl}/api/integrations/whatsapp/webhook` : '/api/integrations/whatsapp/webhook'}
          isTestTenant={Boolean(tenant.is_test)}
        />
      )}
    </div>
  );
}
