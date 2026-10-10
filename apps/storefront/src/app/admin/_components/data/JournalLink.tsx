import Link from 'next/link';
import { IconHistory } from '@tabler/icons-react';
import type { Tenant } from '@lepefy/types';
import { journalAvailable } from '@/lib/audit/access';
import { ACTIVITY_LIST } from '@/lib/audit/activityListParams';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';

/**
 * « Voir dans le journal » for pages that keep their own history (Gestion):
 * rendered only when the Journal d'activité is open to this admin.
 */
export default async function JournalLink({ tenant, resourceType, resourceId }: { tenant: Tenant; resourceType: string; resourceId: string }) {
  const access = await getCurrentAdminAccessContext(tenant.id).catch(() => null);
  if (!(await journalAvailable(tenant, access).catch(() => false))) return null;
  const href = ACTIVITY_LIST.href('/admin/activite', ACTIVITY_LIST.parse({}), { period: '730d', rt: resourceType, rid: resourceId });
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-semibold text-a-brand-fg hover:underline">
      <IconHistory size={15} aria-hidden="true" />Voir dans le journal
    </Link>
  );
}
