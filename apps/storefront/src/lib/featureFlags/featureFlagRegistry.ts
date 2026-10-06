/**
 * Registro dei flag di rilascio (tabella tenant_feature_flags, migration 138).
 * Importabile anche dai Client Components: nessuna dipendenza server.
 *
 * REGOLA: ogni feature nuova nasce con un flag, spento di default.
 * 1. Aggiungi qui una definizione con una chiave generica (mai il nome di un
 *    tenant): `{ key: 'nuovo_checkout', label: '…', description: '…' }`.
 * 2. Nel codice server proteggi la feature con
 *    `await isFeatureEnabled(tenant.id, 'nuovo_checkout')` (lib/featureFlags/featureFlags.ts).
 * 3. Accendi il flag sul tenant di test da /admin/parametres/fonctionnalites,
 *    verifica, poi accendilo sugli altri tenant.
 * 4. Quando la feature è attiva ovunque, rimuovi il flag dal codice e da qui.
 *
 * Riga assente in tenant_feature_flags = flag spento.
 */

export interface FeatureFlagDefinition {
  key: string;
  /** Nome breve mostrato in admin (francese). */
  label: string;
  /** Cosa cambia quando il flag è attivo (francese). */
  description: string;
}

/** Stesso formato del CHECK SQL tenant_feature_flags_key_format. */
export const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = [
  {
    // Gestion du commerce (migration 139, docs/BUSINESS_MANAGEMENT.md).
    key: 'business_management',
    label: 'Gestion du commerce',
    description: 'Active l\'espace de gestion des fournisseurs, achats, dettes et trésorerie.',
  },
  {
    // Canal WhatsApp Business multi-tenant (migration 147, docs/WHATSAPP_BUSINESS_PLATFORM.md).
    key: 'whatsapp_business',
    label: 'WhatsApp Business',
    description: 'Active le canal WhatsApp (réception des messages, réponses automatiques, Nala, boîte de réception de l\'équipe).',
  },
];

export function featureFlagDefinition(key: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAG_DEFINITIONS.find((definition) => definition.key === key);
}
