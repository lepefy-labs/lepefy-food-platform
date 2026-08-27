import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getAdminId } from '@/lib/auth/getAdminId';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const actorId = await getAdminId();
  if (!actorId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 }); }
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 500) : '';
  const permissionKeys = Array.isArray(body.permissionKeys)
    ? Array.from(new Set(body.permissionKeys.filter((value): value is string => typeof value === 'string')))
    : [];
  if (name.length < 2) return NextResponse.json({ error: 'Nom de rôle invalide.' }, { status: 400 });

  const service = createServiceClient();
  const { data: role } = await service.from('admin_roles').select('id, code, name, description, scope, is_system').eq('id', params.id).maybeSingle();
  if (!role) return NextResponse.json({ error: 'Rôle introuvable.' }, { status: 404 });
  if (role.is_system) return NextResponse.json({ error: 'Les rôles système sont protégés.' }, { status: 409 });
  if (role.scope !== 'tenant') return NextResponse.json({ error: 'Seuls les rôles tenant sont configurables ici.' }, { status: 400 });

  const { data: currentPermissions } = await service.from('admin_role_permissions').select('permission_key').eq('role_id', role.id);
  const beforeState = { name: role.name, description: role.description, permissionKeys: (currentPermissions ?? []).map((row) => row.permission_key).sort() };

  const { error: roleError } = await service.from('admin_roles').update({ name, description: description || null, updated_at: new Date().toISOString() }).eq('id', role.id);
  if (roleError) return NextResponse.json({ error: roleError.message }, { status: 500 });

  const { error: permissionError } = await service.rpc('replace_admin_role_permissions', {
    p_role_id: role.id,
    p_permission_keys: permissionKeys,
  });
  if (permissionError) return NextResponse.json({ error: permissionError.message }, { status: 400 });

  await service.from('admin_access_audit').insert({
    actor_user_id: actorId,
    action: 'role.updated',
    target_type: 'admin_role',
    target_id: role.id,
    before_state: beforeState,
    after_state: { name, description: description || null, permissionKeys: [...permissionKeys].sort() },
  });

  return NextResponse.json({ ok: true });
}
