import { createServiceClient } from '@/lib/supabase/server';
import { getLatestLegalDocument } from './getLatestLegalDocument';

export interface CheckoutConsentState {
  showTermsCheckbox:    boolean;
  showMarketingCheckbox: boolean;
  /** Version CGV courante à faire accepter — null si aucun document publié. */
  termsDocVersion: number | null;
}

// Détermine, côté serveur, si le checkout doit afficher les cases CGV et/ou
// marketing (Ciclo 5) — jamais redemandées à un utilisateur qui a déjà un
// consentement valide pour la version courante. Un guest les voit toujours
// (première interaction connue, aucune ligne user_consents à interroger).
export async function resolveCheckoutConsentState(
  tenantId:   string,
  customerId: string | null,
): Promise<CheckoutConsentState> {
  const terms = await getLatestLegalDocument(tenantId, 'terms');
  const termsDocVersion = terms?.version ?? null;

  if (!customerId) {
    // Aucun document publié : rien à faire accepter, même fallback que la
    // page /conditions-generales-vente (Ciclo 2). Marketing reste demandé
    // (première interaction connue pour ce guest).
    return {
      showTermsCheckbox: termsDocVersion !== null,
      showMarketingCheckbox: true,
      termsDocVersion,
    };
  }

  const supabase = createServiceClient();

  const [{ data: termsConsent }, { data: marketingConsent }] = await Promise.all([
    termsDocVersion === null
      ? Promise.resolve({ data: null })
      : supabase
          .from('user_consents')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('user_id', customerId)
          .eq('consent_type', 'terms')
          .eq('doc_version', termsDocVersion)
          .limit(1)
          .maybeSingle(),
    supabase
      .from('user_consents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', customerId)
      .eq('consent_type', 'marketing')
      .limit(1)
      .maybeSingle(),
  ]);

  return {
    // Sans version courante, rien à faire accepter — même raisonnement que
    // pour un guest ci-dessus.
    showTermsCheckbox:     termsDocVersion !== null && !termsConsent,
    showMarketingCheckbox: !marketingConsent,
    termsDocVersion,
  };
}
