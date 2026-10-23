import { isDemoDeployment } from '@/lib/demo/demoEnvironment';

/**
 * Chiave Packlink da usare per un tenant: la sua chiave propria, altrimenti la
 * chiave di piattaforma PACKLINK_API_KEY. Un tenant di test (tenants.is_test,
 * migration 138) non usa mai la chiave di piattaforma: null + log.
 */
export function resolvePacklinkApiKey(
  tenant: { packlink_api_key?: string | null; is_test?: boolean | null },
): string | null {
  // Démo (docs/DEMO_EXPERIENCE.md) : jamais Packlink, même avec une clé propre.
  if (isDemoDeployment()) {
    console.warn('[demo] skipped: packlink');
    return null;
  }
  const own = tenant.packlink_api_key?.trim() ? tenant.packlink_api_key : null;
  if (own) return own;
  if (tenant.is_test) {
    console.warn('[test-tenant] skipped: packlink — no tenant-specific key, platform key not used');
    return null;
  }
  return process.env.PACKLINK_API_KEY ?? null;
}
