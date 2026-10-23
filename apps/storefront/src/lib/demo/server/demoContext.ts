import 'server-only';
import { cookies } from 'next/headers';
import { getTenant } from '@/lib/tenant/getTenant';
import { demoAccessMode, isDemoActive, isDemoDeployment } from '@/lib/demo/demoEnvironment';
import { DEMO_ACCESS_COOKIE, verifyDemoAccessToken } from '@/lib/demo/accessToken';
import type { Tenant } from '@lepefy/types';

export interface DemoContext {
  tenant: Tenant;
  accessMode: 'public' | 'private';
}

/**
 * Contexte de démo pour une route ou une page dynamique : null hors démo
 * (déploiement ou tenant), ce qui doit donner un 404. Jamais pour une page ISR
 * de la boutique (getTenant() n'y est pas autorisé).
 */
export async function getDemoContext(): Promise<DemoContext | null> {
  if (!isDemoDeployment()) return null;
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? '');
  if (!isDemoActive(tenant)) return null;
  return { tenant, accessMode: demoAccessMode() };
}

/** Démo privée : le navigateur a-t-il ouvert un lien d'accès valide ? Démo publique : toujours. */
export function hasDemoAccess(): boolean {
  if (demoAccessMode() === 'public') return true;
  return verifyDemoAccessToken(process.env.DEMO_ACCESS_SECRET, cookies().get(DEMO_ACCESS_COOKIE)?.value) !== null;
}
