import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import NotificationTestConsole from './NotificationTestConsole';

export default async function PlatformNotificationsPage() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
        get(name: string) { return cookieStore.get(name)?.value },
        set() {},
        remove() {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/admin/login');

  const service = createServiceClient();
  const { data: admin } = await service
    .from('admin_users')
    .select('role, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin || admin.role !== 'platform_owner') redirect('/admin');

  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  // Read-only convenience: failure or an unapplied feedback migration falls back safely in the client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: activeFeedbackCampaign } = await (service as any)
    .from('tester_feedback_campaigns')
    .select('google_play_test_url')
    .eq('tenant_id', tenant.id)
    .eq('active', true)
    .maybeSingle();

  return (
    <NotificationTestConsole
      defaultEmail={user.email ?? ''}
      tenantName={tenant.name}
      tenantSlug={tenant.slug}
      defaultGooglePlayTestUrl={activeFeedbackCampaign?.google_play_test_url ?? undefined}
    />
  );
}
