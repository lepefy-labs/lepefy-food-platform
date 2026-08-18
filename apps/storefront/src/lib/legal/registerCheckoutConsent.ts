import type { SupabaseClient } from '@supabase/supabase-js';

// Enregistre le(s) consentement(s) recueillis au checkout (Ciclo 5), au
// moment exact où order_id existe (payment_intent.succeeded / confirmation
// manuelle admin external_link) — jamais avant, cf. règle permanente du
// prompt (order_id n'existe pas au clic checkout). Best-effort : ne doit
// jamais faire échouer une commande déjà créée — l'appelant catch et logue.
export async function registerCheckoutConsent(
  supabase: SupabaseClient,
  params: {
    tenantId:   string;
    orderId:    string;
    customerId: string | null;
    termsAccepted:      boolean | null;
    termsDocVersion:    number  | null;
    marketingAccepted:  boolean | null;
  },
): Promise<void> {
  const { tenantId, orderId, customerId, termsAccepted, termsDocVersion, marketingAccepted } = params;

  const rows: Record<string, unknown>[] = [];

  if (termsAccepted !== null) {
    rows.push({
      tenant_id:    tenantId,
      order_id:     orderId,
      user_id:      customerId,
      consent_type: 'terms',
      granted:      termsAccepted,
      doc_version:  termsDocVersion,
      source:       'checkout',
    });
  }

  if (marketingAccepted !== null) {
    rows.push({
      tenant_id:    tenantId,
      order_id:     orderId,
      user_id:      customerId,
      consent_type: 'marketing',
      granted:      marketingAccepted,
      doc_version:  null,
      source:       'checkout',
    });
  }

  // Aucune case n'était affichée (consentement déjà valide) — rien à
  // insérer, comportement normal, pas une erreur.
  if (rows.length === 0) return;

  const { error } = await supabase.from('user_consents').insert(rows);
  if (error) throw error;
}
