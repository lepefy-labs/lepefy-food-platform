import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

export async function requirePlatformOwner(): Promise<NextResponse | null> {
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
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  const service = createServiceClient();
  const { data: admin } = await service
    .from('admin_users')
    .select('id, role, active')
    .eq('id', user.id)
    .eq('active', true)
    .single();

  if (!admin || admin.role !== 'platform_owner') {
    return NextResponse.json({ error: 'Accès réservé au propriétaire de la plateforme.' }, { status: 403 });
  }

  return null;
}
