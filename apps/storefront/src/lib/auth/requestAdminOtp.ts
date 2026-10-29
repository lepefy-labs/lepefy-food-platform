import { resolveAdminMailIdentity } from '@/lib/authMailer/adminMailTenant';
import { authMailRedirectOptions, authMailerEnabled } from '@/lib/authMailer/otpContext';
import { getAdminAccessContext } from '@/lib/auth/adminRbac';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';

// Échappe % et _ (wildcards ILIKE) avant un filtre .ilike() sans intention de
// wildcard — une adresse email peut légitimement contenir un underscore
// (ex. "john_doe@..."), qui matcherait sinon n'importe quel caractère unique
// à cette position et produirait un faux positif.
function escapeIlike(value: string): string {
  return value.replace(/[%_]/g, (c) => `\\${c}`);
}

export async function requestAdminOtp(email: string): Promise<{ sent: boolean; error?: string }> {
  const trimmedEmail = email.trim();
  const adminClient = createServiceClient();

  // Recherche insensible à la casse — admin_users n'a pas de RLS publique
  // (service_role uniquement, voir requireAdmin.ts), et l'index unique est
  // sur lower(email) : un match ILIKE sans wildcard équivaut à une égalité
  // insensible à la casse.
  const { data: admin } = await adminClient
    .from('admin_users')
    .select('id, role, tenant_id')
    .ilike('email', escapeIlike(trimmedEmail))
    .eq('active', true)
    .maybeSingle();

  if (!admin) {
    // Anti-énumération : depuis l'extérieur, impossible de distinguer "email
    // pas admin" de "email admin, code envoyé" — aucun appel Supabase, aucune
    // erreur remontée. Log serveur uniquement, pour visibilité interne.
    console.warn('[admin] requestAdminOtp: email non admin (ou inactif) a demandé un code —', trimmedEmail);
    return { sent: true };
  }

  // shouldCreateUser: false est délibéré — un admin doit toujours déjà
  // exister dans auth.users (créé par le flux d'invitation d'équipe) avant
  // de pouvoir demander un code : aucune demande OTP ne doit pouvoir créer un
  // compte fantôme.
  const { error } = await adminClient.auth.signInWithOtp({
    email: trimmedEmail,
    options: {
      shouldCreateUser: false,
      // Tenant the admin logs in on (membership checked); platform_owner → "Lepefy" identity.
      ...(authMailerEnabled()
        ? await authMailRedirectOptions({
            ...(await resolveAdminMailIdentity(
              { id: admin.id as string, role: admin.role as string, tenant_id: (admin.tenant_id as string | null) ?? null },
              {
                deploymentTenantId: async () => (await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood')).id,
                hasTenantAccess: async (userId, tenantId) => (await getAdminAccessContext(userId, tenantId)) !== null,
              },
            )),
            email: trimmedEmail,
            redirectPath: '/admin',
          })
        : {}),
    },
  });

  if (error) {
    // Ici l'admin existe réellement : un échec (ex. rate limit Supabase)
    // mérite un message clair, contrairement au cas "email pas admin"
    // ci-dessus — deux situations distinctes, pas le même traitement.
    console.error('[admin] requestAdminOtp error:', error.message);
    return { sent: false, error: error.message };
  }

  return { sent: true };
}
