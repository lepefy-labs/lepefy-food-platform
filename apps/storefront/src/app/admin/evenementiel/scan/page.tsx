import { redirect } from 'next/navigation';
import { getTenant } from '@/lib/tenant/getTenant';
import { getAdminWorkspaceUrls } from '@/lib/admin/workspace';

export const dynamic = 'force-dynamic';

export default async function LegacyEventScanPage({ searchParams }: { searchParams?: { event_id?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const { eventsBaseUrl } = getAdminWorkspaceUrls(tenant);
  const query = searchParams?.event_id ? `?event_id=${encodeURIComponent(searchParams.event_id)}` : '';
  redirect(eventsBaseUrl ? `${eventsBaseUrl}/scan${query}` : `/scan${query}`);
}
