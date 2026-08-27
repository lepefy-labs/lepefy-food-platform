import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

export default async function PlatformAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const auth = createServerClient(
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

  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect('/admin/login');

  const service = createServiceClient();
  const { data: admin } = await service
    .from('admin_users')
    .select('role, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin || admin.role !== 'platform_owner') redirect('/admin');
  return children;
}
