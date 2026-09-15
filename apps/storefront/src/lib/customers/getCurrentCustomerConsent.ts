import { createServiceClient } from '@/lib/supabase/server';

export interface CurrentCustomerConsent {
  granted: boolean;
  decidedAt: string | null;
  source: string | null;
}

export function latestTenantConsentDecision(
  tenantId: string,
  rows: Array<{ tenant_id: string; granted: boolean; created_at: string; source: string }>,
): CurrentCustomerConsent {
  return latestConsentDecision(rows.filter((row) => row.tenant_id === tenantId));
}

export function latestConsentDecision(rows: Array<{ granted: boolean; created_at: string; source: string }>): CurrentCustomerConsent {
  const latest = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return { granted: latest?.granted === true, decidedAt: latest?.created_at ?? null, source: latest?.source ?? null };
}

export async function getCurrentCustomerConsent(
  tenantId: string,
  customerId: string,
  consentType = 'marketing',
): Promise<CurrentCustomerConsent> {
  const { data, error } = await createServiceClient().from('user_consents')
    .select('granted, created_at, source')
    .eq('tenant_id', tenantId).eq('user_id', customerId).eq('consent_type', consentType)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return latestConsentDecision(data ? [data] : []);
}
