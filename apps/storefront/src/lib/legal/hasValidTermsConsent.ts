import { createServiceClient } from '@/lib/supabase/server';
import { getLatestLegalDocument } from './getLatestLegalDocument';

// Ciclo 6 — un customer a un consentement CGV valide si une ligne
// user_consents existe pour la version courante du document 'terms'. Un
// tenant sans document publié n'a rien à faire accepter : retourne toujours
// true (aucun gate possible sans version à référencer).
export async function hasValidTermsConsent(tenantId: string, customerId: string): Promise<boolean> {
  const terms = await getLatestLegalDocument(tenantId, 'terms');
  if (!terms) return true;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('user_consents')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('user_id', customerId)
    .eq('consent_type', 'terms')
    .eq('doc_version', terms.version)
    .limit(1)
    .maybeSingle();

  return !!data;
}
