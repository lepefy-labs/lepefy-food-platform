import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

/**
 * Tenant targeted by a platform-owner notification console (history,
 * catch-up). Callers must have passed requirePlatformOwner(): the platform
 * owner may act on any tenant. Default = the deployment tenant.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePlatformTenantId(requested: string | null | undefined): Promise<string | null> {
  if (!requested) {
    const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
    return tenant.id;
  }
  if (!UUID.test(requested)) return null;
  const { data } = await createServiceClient().from('tenants').select('id').eq('id', requested).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export interface PlatformTenantOption { id: string; slug: string; name: string; isTest: boolean }

export async function listPlatformTenants(): Promise<PlatformTenantOption[]> {
  const { data, error } = await createServiceClient().from('tenants').select('id, slug, name, is_test').order('name', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; slug: string; name: string; is_test: boolean | null }>)
    .map((row) => ({ id: row.id, slug: row.slug, name: row.name, isTest: row.is_test === true }));
}
