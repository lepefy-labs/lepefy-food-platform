import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { canAdmin, getAdminAccessContext } from '@/lib/auth/adminRbac';
import { EVENTS_SCAN_PATH } from '@/lib/auth/adminRoutePermissions';
import { getEventCheckinWindowState } from '@/lib/events/checkinWindow';
import LogoutButton from '../../LogoutButton';
import { ScanClient } from './ScanClient';

export const dynamic = 'force-dynamic';

interface ScanEventRow { id: string; title: string; date_start: string; status: 'draft' | 'published' | 'closed' | 'cancelled'; checkin_opens_at?: string | null; checkin_closes_at?: string | null; }
function resolveInitialEventId(events: ScanEventRow[], requestedEventId: string): string {
  if (events.some(event => event.id === requestedEventId)) return requestedEventId;
  const activeWindow = events.find(event => event.status === 'published' && !getEventCheckinWindowState(event).blockingReason);
  if (activeWindow) return activeWindow.id;
  return events.find(event => event.status === 'published')?.id ?? events[0]?.id ?? '';
}

/**
 * Meal-service scanner. It lives under /admin/ so the installed Lepefy Admin
 * app keeps it in its scope; the former /scan URL redirects here. Its own
 * minimal shell and scan.access check are unchanged (cashier-style access).
 */
export default async function MealServicePage({ searchParams }: { searchParams?: { event_id?: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const selfPath = `${EVENTS_SCAN_PATH}${searchParams?.event_id ? `?event_id=${encodeURIComponent(searchParams.event_id)}` : ''}`;

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
  if (!user) redirect(`/admin/login?next=${encodeURIComponent(selfPath)}`);

  const access = (await getAdminAccessContext(user.id, tenant.id)) ?? (await getAdminAccessContext(user.id, null));
  if (!access || !canAdmin(access, 'scan.access')) redirect('/admin/login?error=unauthorized');
  if (!access.profileCompleted) redirect(`/admin/onboarding?next=${encodeURIComponent(EVENTS_SCAN_PATH)}`);

  const adminClient = createServiceClient();
  const { data: eventRows } = await adminClient.from('events').select('*').eq('tenant_id', tenant.id).in('status', ['published', 'closed']).order('date_start', { ascending: false }).limit(50);
  const events: ScanEventRow[] = (eventRows ?? []).map(row => ({ id: row.id as string, title: row.title as string, date_start: row.date_start as string, status: row.status as ScanEventRow['status'], checkin_opens_at: (row as ScanEventRow).checkin_opens_at ?? null, checkin_closes_at: (row as ScanEventRow).checkin_closes_at ?? null }));
  const initialEventId = resolveInitialEventId(events, searchParams?.event_id ?? '');
  const displayName = access.nickname || [access.firstName, access.lastName].filter(Boolean).join(' ') || access.email;
  const canOpenEvents = canAdmin(access, 'events.view');

  return (
    <div className="min-h-screen bg-a-bg">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-a-border bg-a-surface px-4 py-3">
        {tenant.logo_url && <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto rounded bg-white object-contain" />}
        <div className="min-w-0">
          <span className="block truncate text-sm font-bold text-a-text">{tenant.name}</span>
          <span className="block truncate text-xs font-medium text-a-text-3">Service repas · {displayName}</span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          {canOpenEvents && <Link href="/admin/evenementiel" className="text-xs font-semibold text-a-brand-fg hover:underline">Espace Événementiel</Link>}
          <LogoutButton />
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-5">
        <ScanClient eventsEnabled={tenant.events_enabled} events={events} initialEventId={initialEventId} />
      </main>
    </div>
  );
}
