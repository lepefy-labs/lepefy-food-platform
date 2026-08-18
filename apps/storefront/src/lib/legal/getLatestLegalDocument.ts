import { createPublicClient } from '@/lib/supabase/public';

export type LegalDocType = 'terms' | 'privacy';

export interface TenantLegalDocument {
  content: string;
  version: number;
  effective_date: string;
}

// Lecture publique (pas de session) de la dernière version d'un document
// légal pour un tenant — réutilisée par la page /conditions-generales-vente
// (Ciclo 2) et par l'enregistrement du consentement au signup (Ciclo 4).
export async function getLatestLegalDocument(
  tenantId: string,
  docType: LegalDocType,
): Promise<TenantLegalDocument | null> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from('tenant_legal_documents')
    .select('content, version, effective_date')
    .eq('tenant_id', tenantId)
    .eq('doc_type', docType)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as TenantLegalDocument | null;
}
