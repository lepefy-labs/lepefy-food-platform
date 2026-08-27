import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { getAdminId } from '@/lib/auth/getAdminId';
import { notifyAdminInvited } from '@/lib/notifications/notifyAdminInvited';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_ROLE_CODES = new Set(['platform_owner', 'tenant_admin', 'tenant_cashier']);

async function findAuthUserByEmail(adminClient: ReturnType<typeof createServiceClient>, email: string) {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
}

export async function POST(req: NextRequest) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;

  const currentAdminId = await getAdminId();
  if (!currentAdminId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });

  let body: { email?: unknown; roleId?: unknown; tenantId?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 }); }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const roleId = typeof body.roleId === 'string' ? body.roleId.trim() : '';
  const tenantIdInput = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId : null;
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 });
  if (!roleId) return NextResponse.json({ error: 'Rôle obligatoire.' }, { status: 400 });

  const adminClient = createServiceClient();
  let role: { id: string | null; code: string; name: string; scope: 'tenant' | 'platform' } | null = null;

  if (roleId.startsWith('legacy:')) {
    const code = roleId.slice('legacy:'.length);
    if (!LEGACY_ROLE_CODES.has(code)) return NextResponse.json({ error: 'Rôle invalide.' }, { status: 400 });
    role = {
      id: null,
      code,
      name: code === 'platform_owner' ? 'Propriétaire plateforme' : code === 'tenant_admin' ? 'Administrateur tenant' : 'Caissier',
      scope: code === 'platform_owner' ? 'platform' : 'tenant',
    };
  } else {
    const { data: roleRow, error } = await adminClient.from('admin_roles').select('id, code, name, scope, active').eq('id', roleId).eq('active', true).maybeSingle();
    if (error || !roleRow) return NextResponse.json({ error: 'Rôle introuvable. Vérifiez que la migration RBAC est appliquée.' }, { status: 400 });
    role = { id: roleRow.id, code: roleRow.code, name: roleRow.name, scope: roleRow.scope === 'platform' ? 'platform' : 'tenant' };
  }

  const tenantId = role.scope === 'platform' ? null : tenantIdInput;
  if (role.scope === 'tenant' && !tenantId) return NextResponse.json({ error: 'Tenant obligatoire pour ce rôle.' }, { status: 400 });
  if (role.scope === 'platform' && role.code !== 'platform_owner') return NextResponse.json({ error: 'Les rôles plateforme personnalisés ne sont pas encore affectables.' }, { status: 400 });

  let tenantName = 'Plateforme';
  if (tenantId) {
    const { data: tenant } = await adminClient.from('tenants').select('id, name').eq('id', tenantId).single();
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 400 });
    tenantName = tenant.name;
  }

  const { data: currentAdmin } = await adminClient.from('admin_users').select('email').eq('id', currentAdminId).single();

  let userId: string;
  let existingUser = false;
  const found = await findAuthUserByEmail(adminClient, email);
  if (found) {
    userId = found.id;
    existingUser = true;
  } else {
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({ email, email_confirm: true });
    if (createError || !createData.user) return NextResponse.json({ error: `Échec de la création du compte : ${createError?.message ?? 'erreur inconnue'}` }, { status: 500 });
    userId = createData.user.id;
  }

  const { data: existingRow } = await adminClient.from('admin_users').select('id, role, tenant_id').eq('id', userId).maybeSingle();
  if (existingRow?.role === 'platform_owner' && role.code !== 'platform_owner') {
    return NextResponse.json({ error: 'Un Platform Owner existant ne peut pas être rétrogradé par une affectation tenant.' }, { status: 409 });
  }

  if (existingRow) {
    const { error } = await adminClient.from('admin_users').update({ role: role.code, tenant_id: tenantId, active: true }).eq('id', userId);
    if (error) return NextResponse.json({ error: `Échec de la mise à jour : ${error.message}` }, { status: 500 });
  } else {
    const { error } = await adminClient.from('admin_users').insert({ id: userId, email, role: role.code, tenant_id: tenantId, active: true, invited_by: currentAdminId });
    if (error) return NextResponse.json({ error: `Échec de la création : ${error.message}` }, { status: 500 });
  }

  if (role.id) {
    let membershipQuery = adminClient.from('admin_memberships').select('id, role_id').eq('user_id', userId);
    membershipQuery = tenantId ? membershipQuery.eq('tenant_id', tenantId) : membershipQuery.is('tenant_id', null);
    const { data: membership } = await membershipQuery.maybeSingle();
    if (membership) {
      const { error } = await adminClient.from('admin_memberships').update({ role_id: role.id, active: true, assigned_by: currentAdminId, updated_at: new Date().toISOString() }).eq('id', membership.id);
      if (error) return NextResponse.json({ error: `Échec de l’affectation du rôle : ${error.message}` }, { status: 500 });
    } else {
      const { error } = await adminClient.from('admin_memberships').insert({ user_id: userId, tenant_id: tenantId, role_id: role.id, active: true, assigned_by: currentAdminId });
      if (error) return NextResponse.json({ error: `Échec de l’affectation du rôle : ${error.message}` }, { status: 500 });
    }

    await adminClient.from('admin_access_audit').insert({
      actor_user_id: currentAdminId,
      tenant_id: tenantId,
      action: existingRow ? 'membership.role_changed' : 'membership.created',
      target_type: 'admin_user',
      target_id: userId,
      before_state: existingRow ? { role: existingRow.role, tenant_id: existingRow.tenant_id } : null,
      after_state: { role_id: role.id, role_code: role.code, tenant_id: tenantId },
    });
  }

  try {
    await notifyAdminInvited({
      email,
      role: role.name,
      tenantName,
      invitedByEmail: currentAdmin?.email ?? '',
      loginUrl: `${req.nextUrl.origin}/admin/login`,
    });
  } catch (err) {
    console.error('[team/invite] notifyAdminInvited failed:', err);
  }

  return NextResponse.json({ ok: true, existingUser, onboardingRequired: true });
}
