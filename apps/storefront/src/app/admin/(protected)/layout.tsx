import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { createServerClient } from '@supabase/ssr';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import LogoutButton from '../LogoutButton';
import AdminSidebar from '../_components/AdminSidebar';

export default async function ProtectedAdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();

  // Provide both old (get/set/remove) and new (getAll/setAll) cookie APIs.
  // @supabase/ssr@0.3.x reads cookies via get(name) internally, not getAll().
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/admin/login');
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase());

  if (!adminEmails.includes(user.email?.toLowerCase() ?? '')) {
    redirect('/admin/login?error=unauthorized');
  }

  const slug      = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant    = await getTenant(slug);
  const supabase  = createServiceClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, slug')
    .eq('tenant_id', tenant.id)
    .order('position');

  return (
    <>
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 sticky top-0 z-10">
        {tenant.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tenant.logo_url} alt={tenant.name} className="h-8 w-auto object-contain" />
        )}
        <div>
          <span className="font-bold text-gray-900 text-sm">{tenant.name}</span>
          <span className="ml-2 text-xs text-gray-400 font-medium uppercase tracking-wide">
            Administration
          </span>
        </div>
        <div className="ml-auto">
          <LogoutButton />
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-57px)]">
        <aside className="w-56 bg-white border-r border-gray-200 px-3 py-2 shrink-0 hidden md:block">
          <Suspense fallback={<div className="w-56 h-full" />}>
            <AdminSidebar categories={categories ?? []} />
          </Suspense>
        </aside>
        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </>
  );
}
