import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createServiceClient } from '@/lib/supabase/server';

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export async function PUT(req: NextRequest) {
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
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 }); }

  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const nickname = clean(body.nickname, 60);
  const phone = clean(body.phone, 30);
  if (firstName.length < 2 || lastName.length < 2 || nickname.length < 2) {
    return NextResponse.json({ error: 'Prénom, nom et nickname sont obligatoires.' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: admin } = await service.from('admin_users').select('id, tenant_id, active').eq('id', user.id).eq('active', true).maybeSingle();
  if (!admin) return NextResponse.json({ error: 'Accès admin refusé.' }, { status: 403 });

  const { error } = await service
    .from('admin_users')
    .update({
      first_name: firstName,
      last_name: lastName,
      nickname,
      phone: phone || null,
      profile_completed_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) {
    const migrationMissing = /column|schema cache/i.test(error.message);
    return NextResponse.json(
      { error: migrationMissing ? 'Migration RBAC 085 non appliquée.' : error.message },
      { status: migrationMissing ? 503 : 500 },
    );
  }

  await service.from('admin_access_audit').insert({
    actor_user_id: user.id,
    tenant_id: admin.tenant_id,
    action: 'profile.updated',
    target_type: 'admin_user',
    target_id: user.id,
    after_state: { first_name: firstName, last_name: lastName, nickname, phone: phone || null },
  });

  return NextResponse.json({ ok: true });
}
