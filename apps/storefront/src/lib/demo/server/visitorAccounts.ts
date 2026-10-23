import { randomBytes, randomUUID } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/server';
import { DEMO_VISIT_HOURS } from '@/lib/demo/demoEnvironment';
import { DEMO_VISITOR_ROLE } from '@/lib/demo/visitorPermissions';

/**
 * Comptes visiteurs éphémères de la démo (migration 167) : un compte par
 * visite, mot de passe aléatoire jamais montré ni conservé, rôle demo_visitor
 * (lecture seule), expiration DEMO_VISIT_HOURS. Pas de compte partagé : un
 * visiteur ne peut ni changer le mot de passe des autres ni prolonger sa visite.
 */

const AUDIT_ACTOR = { actorType: 'system' as const, label: 'Démo — visite', ref: 'demo/visit', source: 'app' as const };

export interface VisitorCredentials { userId: string; email: string; password: string; expiresAt: Date }

export async function createVisitorAccount(tenantId: string, now = new Date()): Promise<VisitorCredentials> {
  const service = createServiceClient({ auditActor: AUDIT_ACTOR });
  const { data: role, error: roleError } = await service.from('admin_roles').select('id').eq('code', DEMO_VISITOR_ROLE).eq('active', true).maybeSingle();
  if (roleError || !role) throw new Error('demo_visitor_role_missing');

  const email = `visiteur-${randomUUID().slice(0, 13)}@demo.invalid`;
  const password = randomBytes(24).toString('base64url');
  const expiresAt = new Date(now.getTime() + DEMO_VISIT_HOURS * 3600_000);

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { demo_visitor: true },
  });
  if (createError || !created.user) throw new Error(`demo_visitor_create_failed: ${createError?.message ?? 'no user'}`);
  const userId = created.user.id;

  try {
    const { error: adminError } = await service.from('admin_users').insert({
      id: userId, email, role: DEMO_VISITOR_ROLE, tenant_id: tenantId, active: true,
      first_name: 'Visiteur', last_name: 'Démo', nickname: 'Visiteur', profile_completed_at: now.toISOString(),
    });
    if (adminError) throw new Error(adminError.message);
    const { error: membershipError } = await service.from('admin_memberships').insert({ user_id: userId, tenant_id: tenantId, role_id: role.id, active: true });
    if (membershipError) throw new Error(membershipError.message);
    const { error: visitError } = await service.from('demo_visitor_accounts').insert({
      user_id: userId, tenant_id: tenantId, created_at: now.toISOString(), expires_at: expiresAt.toISOString(),
    });
    if (visitError) throw new Error(visitError.message);
  } catch (error) {
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    throw new Error(`demo_visitor_setup_failed: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  return { userId, email, password, expiresAt };
}

/** Visite encore valable ? (getAdminAccessContext refuse une visite expirée.) */
export async function isVisitorAccountValid(userId: string, tenantId: string | null): Promise<boolean> {
  const { data, error } = await createServiceClient().from('demo_visitor_accounts')
    .select('expires_at, tenant_id').eq('user_id', userId).maybeSingle();
  if (error || !data) return false;
  if (tenantId && data.tenant_id !== tenantId) return false;
  return new Date(data.expires_at).getTime() > Date.now();
}

/**
 * Supprime les comptes visiteurs expirés (au plus `limit` par appel) : compte
 * Auth supprimé, admin_users / membership / visite suivent en cascade.
 * Ne lève jamais.
 */
export async function purgeExpiredVisitors(limit = 20): Promise<number> {
  try {
    const service = createServiceClient({ auditActor: AUDIT_ACTOR });
    const { data } = await service.from('demo_visitor_accounts').select('user_id')
      .lt('expires_at', new Date().toISOString()).order('expires_at').limit(limit);
    let removed = 0;
    for (const row of (data ?? []) as Array<{ user_id: string }>) {
      await service.from('admin_users').update({ active: false }).eq('id', row.user_id);
      const { error } = await service.auth.admin.deleteUser(row.user_id);
      if (!error) removed++;
    }
    return removed;
  } catch (error) {
    console.warn('[demo] visitor purge failed:', error);
    return 0;
  }
}
