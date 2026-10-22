import { notFound } from 'next/navigation';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { platformOwners, platformTicketDetail } from '@/lib/support/server/platformService';
import { supportReference } from '@/lib/support/domain';
import { Breadcrumb } from '../../../../_components/ui/AdminPageHeader';
import PlatformTicketClient from './PlatformTicketClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// Platform-owner access: app/admin/(protected)/platform/layout.tsx + supportPlatformApi on every API.
export default async function PlatformAssistanceTicketPage({ params }: { params: { id: string } }) {
  const access = await getCurrentAdminAccessContext(null);
  const [detail, owners] = await Promise.all([
    platformTicketDetail(params.id, access?.userId ?? '').catch(() => null),
    platformOwners().catch(() => []),
  ]);
  if (!detail) notFound();
  return (
    <div className="space-y-3">
      <Breadcrumb items={[{ label: 'Assistance tenants', href: '/admin/platform/assistance' }, { label: supportReference(detail.ticket.number) }]} />
      <PlatformTicketClient initialDetail={detail} owners={owners} currentAdminId={access?.userId ?? null} />
    </div>
  );
}
