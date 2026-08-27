import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';
import AdminProfileForm from './AdminProfileForm';

export const dynamic = 'force-dynamic';

function safeNext(value?: string): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/admin';
  return value;
}

export default async function AdminOnboardingPage({ searchParams }: { searchParams?: { next?: string; edit?: string } }) {
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
  if (!user) redirect(`/admin/login?next=${encodeURIComponent('/admin/onboarding')}`);

  const service = createServiceClient();
  const { data: admin } = await service.from('admin_users').select('id, email, active').eq('id', user.id).eq('active', true).maybeSingle();
  if (!admin) redirect('/admin/login?error=unauthorized');

  const { data: profile, error } = await service
    .from('admin_users')
    .select('first_name, last_name, nickname, phone, profile_completed_at')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 px-4 py-12">
        <div className="mx-auto max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">Lepefy Admin</p>
          <h1 className="mt-2 text-xl font-semibold text-gray-950">Profil administrateur</h1>
          <p className="mt-3 text-sm text-amber-700">Le nouveau profil administrateur nécessite la migration RBAC 085 avant de pouvoir être configuré.</p>
        </div>
      </main>
    );
  }

  const editing = searchParams?.edit === '1';
  const nextPath = editing ? '/admin' : safeNext(searchParams?.next);
  if (profile?.profile_completed_at && !editing) redirect(nextPath);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10 sm:py-14">
      <div className="mx-auto max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">Lepefy Admin</p>
        <h1 className="mt-2 text-2xl font-semibold text-gray-950">{editing ? 'Mon profil' : 'Bienvenue dans votre espace admin'}</h1>
        <p className="mt-2 text-sm leading-6 text-gray-500">
          {editing
            ? 'Mettez à jour vos informations de profil.'
            : 'Avant de commencer, renseignez vos informations.'}
        </p>
        <AdminProfileForm
          email={admin.email ?? user.email ?? ''}
          initial={{
            firstName: profile?.first_name ?? '',
            lastName: profile?.last_name ?? '',
            nickname: profile?.nickname ?? '',
            phone: profile?.phone ?? '',
          }}
          nextPath={nextPath}
          editing={editing}
        />
      </div>
    </main>
  );
}
