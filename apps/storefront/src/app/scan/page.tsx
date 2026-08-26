import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { getAdminWorkspaceUrls, resolveAdminWorkspace } from '@/lib/admin/workspace';
import LogoutButton from '../admin/LogoutButton';
import { ScanClient } from '../admin/evenementiel/scan/ScanClient';

export const dynamic = 'force-dynamic';

interface ScanEventRow { id: string; title: string; date_start: string; status: 'draft' | 'published' | 'closed' | 'cancelled'; checkin_opens_at?: string | null; checkin_closes_at?: string | null; }
function resolveInitialEventId(events: ScanEventRow[], requestedEventId: string): string {
  if (events.some(event => event.id === requestedEventId)) return requestedEventId;
  const now = Date.now();
  const activeWindow = events.find(event => { const opensAt = event.checkin_opens_at ? new Date(event.checkin_opens_at).getTime() : Number.NEGATIVE_INFINITY; const closesAt = event.checkin_closes_at ? new Date(event.checkin_closes_at).getTime() : Number.POSITIVE_INFINITY; return event.status === 'published' && now >= opensAt && now <= closesAt; });
  if (activeWindow) return activeWindow.id;
  return events.find(event => event.status === 'published')?.id ?? events[0]?.id ?? '';
}

export default async function MealServicePage({ searchParams }: { searchParams?: { event_id?: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const workspaceUrls = getAdminWorkspaceUrls(tenant);
  const requestHost = headers().get('host');
  if (resolveAdminWorkspace(requestHost) !== 'events' && workspaceUrls.eventsBaseUrl) {
    const query = searchParams?.event_id ? `?event_id=${encodeURIComponent(searchParams.event_id)}` : '';
    redirect(`${workspaceUrls.eventsBaseUrl}/scan${query}`);
  }

  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/admin/login?next=${encodeURIComponent(`/scan${searchParams?.event_id ? `?event_id=${searchParams.event_id}` : ''}`)}`);

  const adminClient = createServiceClient();
  const { data: admin } = await adminClient.from('admin_users').select('id, role, tenant_id, active').eq('id', user.id).eq('active', true).single();
  if (!admin) redirect('/admin/login?error=unauthorized');
  if (admin.role !== 'platform_owner' && admin.tenant_id !== tenant.id) redirect('/admin/login?error=unauthorized');
  if (!['platform_owner', 'tenant_admin', 'tenant_cashier'].includes(admin.role)) redirect('/admin/login?error=unauthorized');

  const { data: eventRows } = await adminClient.from('events').select('*').eq('tenant_id', tenant.id).in('status', ['published', 'closed']).order('date_start', { ascending: false }).limit(50);
  const events: ScanEventRow[] = (eventRows ?? []).map(row => ({ id: row.id as string, title: row.title as string, date_start: row.date_start as string, status: row.status as ScanEventRow['status'], checkin_opens_at: (row as ScanEventRow).checkin_opens_at ?? null, checkin_closes_at: (row as ScanEventRow).checkin_closes_at ?? null }));
  const initialEventId = resolveInitialEventId(events, searchParams?.event_id ?? '');

  return <div className="min-h-screen bg-gray-50"><header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">{tenant.logo_url && <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto object-contain" />}<div className="min-w-0"><span className="block truncate text-sm font-bold text-gray-900">{tenant.name}</span><span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">Service repas</span></div><div className="ml-auto"><LogoutButton /></div></header><main className="mx-auto max-w-md px-4 py-5"><ScanClient eventsEnabled={tenant.events_enabled} events={events} initialEventId={initialEventId} /></main></div>;
}
