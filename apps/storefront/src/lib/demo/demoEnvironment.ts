/**
 * Demo Experience (docs/DEMO_EXPERIENCE.md, migration 167).
 *
 * Deux clés indépendantes :
 * - le déploiement : variable serveur LEPEFY_DEPLOYMENT_KIND=demo (projet Vercel
 *   lepefy-demo, base Supabase séparée de la production) ;
 * - le tenant : tenants.is_demo = true (toujours is_test, contrainte SQL).
 *
 * Règle :
 * - BLOQUER un effet réel (e-mail, WhatsApp, Packlink, n8n, clé Stripe live)
 *   suffit d'UNE clé : isDemoDeployment() le fait dès la variable posée, et le
 *   tenant is_demo est aussi is_test, donc couvert par les garde-fous de la 138 ;
 * - OUVRIR une fonction de démo (page d'accueil, comptes visiteurs, console)
 *   exige LES DEUX (isDemoActive).
 *
 * Module sans dépendance serveur : importable par les tests.
 */

export type DemoAccessMode = 'public' | 'private';

type Env = Record<string, string | undefined>;

export function isDemoDeployment(env: Env = process.env): boolean {
  return env.LEPEFY_DEPLOYMENT_KIND === 'demo';
}

/** private = chaque page demande le lien d'accès signé (scénario d'un prospect). */
export function demoAccessMode(env: Env = process.env): DemoAccessMode {
  return env.DEMO_ACCESS_MODE === 'private' ? 'private' : 'public';
}

export function isDemoTenant(tenant: { is_demo?: boolean | null; is_test?: boolean | null }): boolean {
  return tenant.is_demo === true && tenant.is_test === true;
}

export function isDemoActive(tenant: { is_demo?: boolean | null; is_test?: boolean | null }, env: Env = process.env): boolean {
  return isDemoDeployment(env) && isDemoTenant(tenant);
}

/**
 * Incohérence entre les deux clés : un déploiement de démo qui sert un tenant
 * réel, ou un tenant de démo servi par un déploiement normal. Les fonctions de
 * démo restent fermées ; la page l'affiche au propriétaire de la plateforme.
 */
export function demoKeyMismatch(tenant: { is_demo?: boolean | null; is_test?: boolean | null }, env: Env = process.env): boolean {
  return isDemoDeployment(env) !== isDemoTenant(tenant);
}

/** Une clé Stripe est-elle utilisable en démo ? Seules les clés de test le sont. */
export function isStripeTestKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && /^(sk|rk)_test_/.test(key);
}

/** Durée d'une visite en lecture seule. */
export const DEMO_VISIT_HOURS = 4;

/** Version de l'information affichée avec le consentement du formulaire de demande. */
export const DEMO_REQUEST_CONSENT_VERSION = 'demo-request-2026-10';
