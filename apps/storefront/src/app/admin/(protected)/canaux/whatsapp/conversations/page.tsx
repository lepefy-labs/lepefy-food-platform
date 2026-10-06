import { createServiceClient } from '@/lib/supabase/server';
import { listInbox, loadLiveChannel, parseInboxFilter } from '@/lib/whatsapp/adminQueries';
import { requireWhatsAppPage } from '@/lib/whatsapp/server/featureGate';
import AdminPageHeader from '../../../../_components/ui/AdminPageHeader';
import WhatsAppTabs from '../_components/WhatsAppTabs';
import { loadNeedsHumanCount } from '../_components/loadNeedsHumanCount';
import InboxClient from './InboxClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function WhatsAppConversationsPage({ searchParams }: { searchParams?: { filter?: string; c?: string } }) {
  const { tenant, can } = await requireWhatsAppPage('whatsapp.view');
  const db = createServiceClient();
  const filter = parseInboxFilter(searchParams?.filter);
  const [items, channel, needsHuman] = await Promise.all([
    listInbox(db, tenant.id, filter),
    loadLiveChannel(db, tenant.id),
    loadNeedsHumanCount(tenant.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <AdminPageHeader title="WhatsApp" description="Conversations du numéro de la boutique. Répondre met l’automatisation en pause pour ce client." />
      <WhatsAppTabs active="conversations" needsHumanCount={needsHuman} />
      <InboxClient
        initialItems={items}
        initialFilter={filter}
        initialSelectedId={typeof searchParams?.c === 'string' ? searchParams.c : null}
        canReply={can('whatsapp.reply')}
        channelDisabled={!channel || channel.status === 'disabled'}
      />
    </div>
  );
}
