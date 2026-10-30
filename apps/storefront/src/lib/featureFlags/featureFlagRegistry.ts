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
  /**
   * Solo il platform owner può cambiarlo (PATCH /api/admin/feature-flags rifiuta
   * gli altri con 403); il tenant lo vede in sola lettura.
   */
  platformOnly?: boolean;
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
  {
    // Import de catalogues WhatsApp externes depuis la console plateforme
    // (migration 149, docs/WHATSAPP_EXTERNAL_CATALOG_IMPORT.md). Le flag autorise
    // le propriétaire de la plateforme à écrire des produits dans CE tenant.
    key: 'external_catalog_import',
    label: 'Import de catalogues WhatsApp',
    description: 'Autorise la console plateforme à créer ou mettre à jour des produits de cette boutique depuis un catalogue WhatsApp externe, après validation produit par produit.',
  },
  {
    // Journal d'activité (migration 153, docs/ADMIN_ACTIVITY_AUDIT.md). Il platform
    // owner lo vede sempre; il flag lo apre all'équipe del tenant.
    key: 'activity_journal',
    label: 'Journal d’activité',
    description: 'Donne à l’équipe de la boutique l’accès au journal des actions, des automatisations et des accès (/admin/activite). Activation réservée à Lepefy.',
    platformOnly: true,
  },
  {
    // Notifications internes WhatsApp (migration 158, docs/NOTIFICATION_SUBSCRIPTIONS.md).
    key: 'staff_whatsapp_notifications',
    label: 'Notifications WhatsApp de l’équipe',
    description: 'Envoie les notifications internes choisies (nouvelle commande, paiement à vérifier, conflit de stock, expéditions…) sur le WhatsApp des destinataires confirmés, depuis le numéro Lepefy. Activation réservée à Lepefy.',
    platformOnly: true,
  },
  {
    // Assistance & suggestions (migration 163, docs/SMART_ASSISTANCE.md).
    key: 'help_center_disabled',
    label: 'Centre d’aide désactivé',
    description: 'Désactive le Centre d’aide pour cette boutique (interrupteur administratif ; sans ligne, le Centre d’aide suit l’abonnement). Activation réservée à Lepefy.',
    platformOnly: true,
  },
  {
    key: 'support_assistance',
    label: 'Assistance Lepefy',
    description: 'Donne à l’équipe de la boutique le bouton « Assistance » : demandes avec captures et page concernée, conversation avec Lepefy, suivi des réponses. Activation réservée à Lepefy.',
    platformOnly: true,
  },
];

export function featureFlagDefinition(key: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAG_DEFINITIONS.find((definition) => definition.key === key);
}
