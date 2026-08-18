import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConsentRow {
  tenant_id:    string;
  user_id?:     string | null;
  order_id?:    string | null;
  consent_type: 'terms' | 'marketing' | 'cookies_analytics' | 'cookies_marketing';
  granted:      boolean;
  doc_version:  number | null;
  source:       'signup' | 'checkout' | 'reconsent_gate' | 'cookie_banner' | 'account_settings';
}

// Base partagée par registerSignupConsent (Ciclo 4), registerCheckoutConsent
// (Ciclo 5) et le gate de re-consentement (Ciclo 6) — les trois construisent
// des lignes différentes selon leur contexte (order_id vs user_id, source),
// mais l'écriture finale dans user_consents est identique.
//
// IMPORTANT — consent_type='marketing' (Ciclo 7) : les lignes créées avant le
// 2026-08-18 ont été recueillies avec un texte ne mentionnant que l'email
// (voir consentCopy.ts pour le texte actuel, étendu à email + SMS +
// WhatsApp). Ne jamais les traiter comme valides pour un envoi SMS/WhatsApp
// tant que l'utilisateur n'a pas réexprimé son consentement avec le nouveau
// texte (gate de re-consentement ou mise à jour des préférences dans
// /compte). Lorsque l'envoi SMS/WhatsApp sera construit, filtrer sur
// created_at >= '2026-08-18'.
export async function insertConsentRows(supabase: SupabaseClient, rows: ConsentRow[]): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('user_consents').insert(rows);
  if (error) throw error;
}
