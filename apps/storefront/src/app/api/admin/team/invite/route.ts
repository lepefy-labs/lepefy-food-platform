import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import type { AdminRole } from '@/lib/auth/requireAdmin';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES: AdminRole[] = ['platform_owner', 'tenant_admin', 'tenant_cashier'];

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

  if (tenantId) {
    const { data: tenant } = await adminClient
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .single();
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant introuvable.' }, { status: 400 });
    }
  }

  // Invitation Supabase Auth — aucune ligne admin_users écrite avant que
  // cette étape (ou la résolution de l'utilisateur existant ci-dessous)
  // n'ait abouti.
  let userId: string;
  let existingUser = false;
  const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(
    email,
    { redirectTo: `${req.nextUrl.origin}/admin/accept-invite` },
  );

  if (inviteError) {
    // Utilisateur auth déjà existant (ex. client storefront inscrit via OTP) :
    // on réutilise son id plutôt que d'échouer — permet de promouvoir un
    // utilisateur existant en admin, ou de changer le rôle/tenant d'un admin
    // déjà présent via ce même formulaire. Vérifie d'abord `error.code`
    // ('email_exists', exposé par @supabase/auth-js — bien plus fiable que le
    // texte du message, qui dépend de la version GoTrue) ; le message
    // ("A user with this email address has already been registered") reste
    // en filet de sécurité — bug corrigé ici : le pattern précédent
    // (`already registered`) ne matchait pas "already **been** registered".
    const alreadyRegistered =
      inviteError.code === 'email_exists'
      || /already\s+(been\s+)?registered|already exists/i.test(inviteError.message);
    if (!alreadyRegistered) {
      return NextResponse.json({ error: `Échec de l'invitation : ${inviteError.message}` }, { status: 400 });
    }

    const found = await findAuthUserByEmail(adminClient, email);
    if (!found) {
      // Cas limite anormal : GoTrue affirme que l'email existe déjà mais
      // listUsers() ne le retrouve pas — on ne procède pas à l'aveugle.
      return NextResponse.json(
        { error: `Échec de l'invitation : ${inviteError.message}` },
        { status: 500 },
      );
    }
    userId = found.id;
    existingUser = true;
  } else {
    userId = inviteData.user.id;
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

  if (!existingUser) {
    return NextResponse.json({ ok: true, existingUser: false });
  }

  // Utilisateur existant promu admin : il n'a jamais eu de mot de passe s'il
  // s'est inscrit via OTP côté storefront (`/admin/login` utilise
  // signInWithPassword) — un email de récupération de mot de passe standard
  // Supabase le renvoie vers /admin/accept-invite, qui gère déjà aussi bien
  // un lien de type "recovery" que "invite" (elle ne fait qu'échanger la
  // session déposée dans l'URL puis appeler updateUser({ password })).
  const { error: resetError } = await adminClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${req.nextUrl.origin}/admin/accept-invite`,
  });

  if (resetError) {
    // La ligne admin_users est déjà écrite : pas de rollback, l'accès est
    // bien accordé. On signale seulement que l'email peut ne pas être parti.
    console.error('[team/invite] resetPasswordForEmail failed for existing user promotion:', resetError);
    return NextResponse.json({ ok: true, existingUser: true, warning: 'admin_created_but_email_failed' });
  }

  return NextResponse.json({ ok: true, existingUser: true });
}
