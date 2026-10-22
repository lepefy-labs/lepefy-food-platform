import { notFound } from 'next/navigation';
import { requireSupportTenantPage } from '@/lib/support/server/access';
import { tenantThread } from '@/lib/support/server/tenantService';
import { supportReference } from '@/lib/support/domain';
import { Breadcrumb } from '../../../_components/ui/AdminPageHeader';
import ConversationClient from './ConversationClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function generateMetadata() {
  return { title: 'Assistance' };
}

/** Conversation of one request of the shop (public projection: no internal note ever). */
export default async function AssistanceConversationPage({ params }: { params: { id: string } }) {
  const { tenant, access } = await requireSupportTenantPage();
  const thread = await tenantThread(tenant.id, params.id, access.userId).catch(() => null);
  if (!thread) notFound();
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumb items={[{ label: 'Assistance', href: '/admin/assistance' }, { label: supportReference(thread.ticket.number) }]} className="mb-2" />
      <ConversationClient initialThread={thread} readOnly={access.isPlatformOwner} />
    </div>
  );
}
