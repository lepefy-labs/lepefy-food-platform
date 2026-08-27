import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getAdminId } from '@/lib/auth/getAdminId';

const CODE_RE = /^[a-z][a-z0-9_]{2,63}$/;

export async function POST(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const actorId = await getAdminId();
  if (!actorId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
  if (name.length < 2 || !CODE_RE.test(code)) return NextResponse.json({ error: 'Nom ou code de rôle invalide.' }, { status: 400 });
  if (['platform_owner', 'tenant_admin', 'tenant_cashier'].includes(code)) return NextResponse.json({ error: 'Code réservé à un rôle système.' }, { status: 409 });

  const service = createServiceClient();
  const { data: role, error } = await service.from('admin_roles').insert({
    code,
    name,
    description: description || null,
    scope: 'tenant',
    is_system: false,
    active: true,
    created_by: actorId,
  }).select('id, code, name').single();
  if (error) return NextResponse.json({ error: error.code === '23505' ? 'Ce code de rôle existe déjà.' : error.message }, { status: error.code === '23505' ? 409 : 500 });

  await service.from('admin_access_audit').insert({
    actor_user_id: actorId,
    action: 'role.created',
    target_type: 'admin_role',
    target_id: role.id,
    after_state: { code, name, description, scope: 'tenant' },
  });

  return NextResponse.json({ ok: true, role });
}
