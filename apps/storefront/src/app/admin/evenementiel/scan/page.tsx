import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import LogoutButton from '../../LogoutButton';
import { ScanClient } from './ScanClient';

export const dynamic = 'force-dynamic';

interface ScanEventRow {
  id: string;
  title: string;
  date_start: string;
  status: 'draft' | 'published' | 'closed' | 'cancelled';
  checkin_opens_at?: string | null;
  checkin_closes_at?: string | null;
}

export default async function EvenementielScanPage({ searchParams }: { searchParams?: { event_id?: string } }) {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() }, setAll() {}, get(name: string) { return cookieStore.get(name)?.value },
        set() {}, remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const adminClient = createServiceClient();
  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, tenant_id, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin) redirect('/admin/login?error=unauthorized');
  if (admin.role !== 'platform_owner' && admin.tenant_id !== tenant.id) redirect('/admin/login?error=unauthorized');
  if (!['platform_owner', 'tenant_admin', 'tenant_cashier'].includes(admin.role)) redirect('/admin/login?error=unauthorized');

  // select('*') keeps rollout backward-compatible: before migration 082 is
  // applied the optional check-in fields are simply absent and therefore unrestricted.
  const { data: eventRows } = await adminClient
    .from('events')
    .select('*')
    .eq('tenant_id', tenant.id)
    .in('status', ['published', 'closed'])
    .order('date_start', { ascending: false })
    .limit(50);

  const events = (eventRows ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    date_start: row.date_start as string,
    status: row.status as ScanEventRow['status'],
    checkin_opens_at: (row as ScanEventRow).checkin_opens_at ?? null,
    checkin_closes_at: (row as ScanEventRow).checkin_closes_at ?? null,
  }));
  const requestedEventId = searchParams?.event_id ?? '';
  const initialEventId = events.some((event) => event.id === requestedEventId)
    ? requestedEventId
    : events.length === 1
      ? events[0]?.id ?? ''
      : '';

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        {tenant.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto object-contain" />
        )}
        <div><span className="font-bold text-gray-900 text-sm">{tenant.name}</span><span className="ml-2 text-xs text-gray-500 font-medium uppercase tracking-wide">Scan événementiel</span></div>
        <div className="ml-auto"><LogoutButton /></div>
      </header>
      <main className="px-4 py-6 max-w-md mx-auto">
        <ScanClient
          eventsEnabled={tenant.events_enabled}
          events={events}
          initialEventId={initialEventId}
          canConfigureCheckin={admin.role === 'tenant_admin' || admin.role === 'platform_owner'}
        />
      </main>
    </div>
  );
}
