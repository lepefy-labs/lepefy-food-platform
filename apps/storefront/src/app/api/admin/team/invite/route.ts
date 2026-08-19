import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { notifyAdminInvited } from '@/lib/notifications/notifyAdminInvited';
import type { AdminRole } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES: AdminRole[] = ['platform_owner', 'tenant_admin', 'tenant_cashier'];

const ROLE_LABELS: Record<AdminRole, string> = {
  platform_owner: 'Propriétaire plateforme',
  tenant_admin: 'Administrateur tenant',
  tenant_cashier: 'Caissier',
};

// Recherche un utilisateur auth.users existant par email, via le SDK admin
// (pagination — même principe que listAuthUsers() dans
// scripts/backfill-admin-users.mjs, mais via le client déjà instancié plutôt
// que fetch brut sur l'endpoint REST Admin).
async function findAuthUserByEmail(
  adminClient: ReturnType<typeof createServiceClient>,
  email: string,
) {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
}

export async function POST(req: NextRequest) {
  // Restriction stricte à platform_owner : allowedRoles vide rejette
  // tenant_admin/tenant_cashier quel que soit le tenant (platform_owner
  // passe toujours, indépendamment de allowedRoles — voir requireAdmin.ts).
  // Le tenantId passé ici n'est jamais évalué pour platform_owner ni pour un
  // rôle absent de allowedRoles : une valeur vide suffit.
  const denied = await requireAdmin('', []);
  if (denied) return denied;

  const currentAdminId = await getAdminId();
  if (!currentAdminId) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 });
  }

  let body: { email?: unknown; role?: unknown; tenantId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = body.role as AdminRole;
  const tenantId = typeof body.tenantId === 'string' && body.tenantId ? body.tenantId : null;

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Adresse e-mail invalide.' }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Rôle invalide.' }, { status: 400 });
  }
  if (role === 'platform_owner' && tenantId !== null) {
    return NextResponse.json(
      { error: 'Un propriétaire plateforme ne doit pas être rattaché à un tenant.' },
      { status: 400 },
    );
  }
  if (role !== 'platform_owner' && !tenantId) {
    return NextResponse.json({ error: 'Tenant obligatoire pour ce rôle.' }, { status: 400 });
  }

  const adminClient = createServiceClient();

  let tenantName = 'Plateforme';
  if (tenantId) {
    const { data: tenant } = await adminClient
      .from('tenants')
      .select('id, name')
      .eq('id', tenantId)
      .single();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 400 });
    }
    tenantName = tenant.name;
  }

  const { data: currentAdmin } = await adminClient
    .from('admin_users')
    .select('email')
    .eq('id', currentAdminId)
    .single();

  // Plus d'email Supabase (inviteUserByEmail / resetPasswordForEmail) : le
  // login admin passe désormais par OTP email (requestAdminOtp.ts), qui ne
  // requiert aucun mot de passe ni lien — le compte est créé directement
  // côté serveur, sans email de système Supabase. Aucune ligne admin_users
  // écrite avant que cette étape (ou la résolution de l'utilisateur
  // existant ci-dessous) n'ait abouti.
  let userId: string;
  let existingUser = false;

  const found = await findAuthUserByEmail(adminClient, email);
  if (found) {
    userId = found.id;
    existingUser = true;
  } else {
    const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (createError || !createData.user) {
      return NextResponse.json(
        { error: `Échec de la création du compte : ${createError?.message ?? 'erreur inconnue'}` },
        { status: 500 },
      );
    }
    userId = createData.user.id;
  }

  // Upsert manuel (pas de .upsert() avec onConflict : idx_admin_users_email
  // est sur lower(email), un index d'expression, pas une colonne directe).
  const { data: existingRow } = await adminClient
    .from('admin_users')
    .select('id')
    .eq('id', userId)
    .single();

  if (existingRow) {
    const { error: updateError } = await adminClient
      .from('admin_users')
      .update({ role, tenant_id: tenantId, active: true })
      .eq('id', userId);
    if (updateError) {
      return NextResponse.json({ error: `Échec de la mise à jour : ${updateError.message}` }, { status: 500 });
    }
  } else {
    const { error: insertError } = await adminClient
      .from('admin_users')
      .insert({
        id: userId,
        email,
        role,
        tenant_id: tenantId,
        active: true,
        invited_by: currentAdminId,
      });
    if (insertError) {
      return NextResponse.json({ error: `Échec de la création : ${insertError.message}` }, { status: 500 });
    }
  }

  // Best-effort — un échec ici ne doit jamais faire échouer la réponse : le
  // compte admin est déjà créé/actif à ce point.
  try {
    await notifyAdminInvited({
      email,
      role: ROLE_LABELS[role],
      tenantName,
      invitedByEmail: currentAdmin?.email ?? '',
      loginUrl: `${req.nextUrl.origin}/admin/login`,
    });
  } catch (err) {
    console.error('[team/invite] notifyAdminInvited failed:', err);
  }

  return NextResponse.json({ ok: true, existingUser });
}
