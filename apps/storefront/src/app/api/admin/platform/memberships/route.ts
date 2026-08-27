import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getAdminId } from '@/lib/auth/getAdminId';

export async function POST(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const actorId = await getAdminId();
  if (!actorId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 }); }
  const userId = typeof body.userId === 'string' ? body.userId : '';
  const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
  const roleId = typeof body.roleId === 'string' ? body.roleId : '';
  if (!userId || !tenantId || !roleId) return NextResponse.json({ error: 'Utilisateur, tenant et rôle sont obligatoires.' }, { status: 400 });

  const service = createServiceClient();
  const [{ data: user }, { data: tenant }, { data: role }] = await Promise.all([
    service.from('admin_users').select('id, email, role, tenant_id, active').eq('id', userId).eq('active', true).maybeSingle(),
    service.from('tenants').select('id, name').eq('id', tenantId).maybeSingle(),
    service.from('admin_roles').select('id, code, name, scope, active').eq('id', roleId).eq('active', true).maybeSingle(),
  ]);
  if (!user || !tenant || !role) return NextResponse.json({ error: 'Utilisateur, tenant ou rôle introuvable.' }, { status: 404 });
  if (role.scope !== 'tenant' || role.code === 'platform_owner') return NextResponse.json({ error: 'Ce rôle ne peut pas être affecté à un tenant.' }, { status: 400 });

  const { data: existing } = await service
    .from('admin_memberships')
    .select('id, role_id, active')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (existing) {
    const { error } = await service.from('admin_memberships').update({ role_id: roleId, active: true, assigned_by: actorId, updated_at: new Date().toISOString() }).eq('id', existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await service.from('admin_memberships').insert({ user_id: userId, tenant_id: tenantId, role_id: roleId, active: true, assigned_by: actorId });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Compatibility mirror used by legacy guards while capability migration is progressive.
  // A custom role remains fail-closed on legacy endpoints because its code is not in allowedRoles.
  const { error: mirrorError } = await service.from('admin_users').update({ role: role.code, tenant_id: tenantId, active: true }).eq('id', userId);
  if (mirrorError) return NextResponse.json({ error: mirrorError.message }, { status: 500 });

  await service.from('admin_access_audit').insert({
    actor_user_id: actorId,
    tenant_id: tenantId,
    action: existing ? 'membership.role_changed' : 'membership.created',
    target_type: 'admin_membership',
    target_id: userId,
    before_state: existing ? { role_id: existing.role_id } : null,
    after_state: { role_id: roleId, role_code: role.code, tenant_id: tenantId },
  });

  return NextResponse.json({ ok: true });
}
