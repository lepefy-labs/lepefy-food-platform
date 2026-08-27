import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getAdminId } from '@/lib/auth/getAdminId';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;

  const currentAdminId = await getAdminId();
  if (!currentAdminId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  if (params.id === currentAdminId) return NextResponse.json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' }, { status: 400 });

  let body: { active?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 }); }
  if (typeof body.active !== 'boolean') return NextResponse.json({ error: '"active" doit être un booléen.' }, { status: 400 });

  const adminClient = createServiceClient();
  const { data: before } = await adminClient.from('admin_users').select('id, active, role, tenant_id').eq('id', params.id).maybeSingle();
  if (!before) return NextResponse.json({ error: 'Administrateur introuvable.' }, { status: 404 });
  if (before.role === 'platform_owner') return NextResponse.json({ error: 'Un Platform Owner doit être géré explicitement hors de cette action.' }, { status: 409 });

  const { error } = await adminClient.from('admin_users').update({ active: body.active }).eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort before migration 085; after migration this keeps memberships aligned.
  const membershipUpdate = await adminClient.from('admin_memberships').update({ active: body.active, updated_at: new Date().toISOString() }).eq('user_id', params.id);
  if (!membershipUpdate.error) {
    await adminClient.from('admin_access_audit').insert({
      actor_user_id: currentAdminId,
      tenant_id: before.tenant_id,
      action: body.active ? 'membership.enabled' : 'membership.disabled',
      target_type: 'admin_user',
      target_id: params.id,
      before_state: { active: before.active },
      after_state: { active: body.active },
    });
  }

  return NextResponse.json({ ok: true });
}
