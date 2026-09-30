import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { TENANT_CACHE_TAG } from '@/lib/cache/storefrontCache';

/**
 * Tenant di test (tenants.is_test, migration 138).
 *
 * Un tenant di test vive nello stesso progetto Supabase di produzione, isolato
 * via tenant_id + RLS. Le sue comunicazioni esterne non devono mai raggiungere
 * clienti reali:
 * - email renderizzate: deviate verso TEST_TENANT_EMAIL_RECIPIENT (lista separata
 *   da virgole), saltate se la variabile non è configurata;
 * - altri webhook n8n: saltati
 *   (entrambi applicati da sendNotification(), lib/events/notifyN8n.ts);
 * - Packlink: solo con una chiave propria del tenant, mai con la chiave di
 *   piattaforma PACKLINK_API_KEY (lib/shipping/packlinkApiKey.ts).
 * Ogni salto è loggato come `[test-tenant] skipped: <canale>`.
 * Ordini e prenotazioni sono marcati is_test = true dal trigger della 138.
 */

// Lettura dedicata (non getTenant()): questo modulo è caricato da
// sendNotification(), usato anche fuori da un render React.
const loadIsTestTenant = unstable_cache(
  async (column: 'id' | 'slug', value: string): Promise<boolean> => {
    const { data, error } = await createServiceClient()
      .from('tenants')
      .select('is_test')
      .eq(column, value)
      .maybeSingle();
    // Non mettere in cache un errore (es. migration 138 non ancora applicata).
    if (error) throw new Error(error.message);
    return Boolean((data as { is_test?: boolean } | null)?.is_test);
  },
  ['tenant-is-test'],
  { revalidate: 60, tags: [TENANT_CACHE_TAG] },
);

async function lookupIsTest(column: 'id' | 'slug', value: string): Promise<boolean> {
  try {
    return await loadIsTestTenant(column, value);
  } catch (error) {
    console.error(`[test-tenant] is_test lookup failed — ${column}:`, value, error);
    return false;
  }
}

/** true se il tenant è di test. Un errore di lettura vale false (loggato). */
export function isTestTenantId(tenantId: string): Promise<boolean> {
  return lookupIsTest('id', tenantId);
}

/** true se il deployment corrente (NEXT_PUBLIC_TENANT_SLUG) è un tenant di test. */
export async function isTestDeployment(): Promise<boolean> {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG;
  return slug ? lookupIsTest('slug', slug) : false;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * true se la notifica riguarda un tenant di test: il tenant del payload
 * (`tenantId`) oppure il tenant del deployment corrente.
 */
export async function isTestTenantNotification(payload: Record<string, unknown>): Promise<boolean> {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : null;
  if (tenantId && UUID.test(tenantId) && await isTestTenantId(tenantId)) return true;
  return isTestDeployment();
}

/** Destinatari fissi per le email di un tenant di test (TEST_TENANT_EMAIL_RECIPIENT). */
export function testTenantEmailRecipients(): string[] {
  return (process.env.TEST_TENANT_EMAIL_RECIPIENT ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);
}

export function logTestTenantSkip(channel: string, detail?: string): void {
  console.warn(`[test-tenant] skipped: ${channel}${detail ? ` — ${detail}` : ''}`);
}
