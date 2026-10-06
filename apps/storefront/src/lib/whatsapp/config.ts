/**
 * Configuration serveur du canal WhatsApp (docs/WHATSAPP_BUSINESS_PLATFORM.md § Secrets).
 * Aucune valeur secrète n'est lue ailleurs que dans ce module et dans
 * provider/credentials.ts ; aucune n'est jamais journalisée.
 */

/** Flag de release (tenant_feature_flags, migration 138) : absent = module inexistant. */
export const WHATSAPP_FEATURE_FLAG = 'whatsapp_business';

/** Version Graph API par défaut ; à surcharger par META_WHATSAPP_API_VERSION à chaque montée de version Meta. */
export const DEFAULT_GRAPH_API_VERSION = 'v23.0';

/** Jeton « system user » de la plateforme, utilisé quand le canal ne référence pas sa propre variable. */
export const PLATFORM_TOKEN_ENV = 'META_WHATSAPP_SYSTEM_USER_TOKEN';

/** Même format que le CHECK SQL tenant_whatsapp_channels.access_token_env. */
export const CHANNEL_TOKEN_ENV_PATTERN = /^META_WHATSAPP_[A-Z0-9_]{1,64}_TOKEN$/;

type Env = Record<string, string | undefined>;

export function graphApiVersion(env: Env = process.env): string {
  const value = env.META_WHATSAPP_API_VERSION?.trim();
  return value && /^v\d{1,3}\.\d{1,2}$/.test(value) ? value : DEFAULT_GRAPH_API_VERSION;
}

/** Secrets d'application Meta (X-Hub-Signature-256). Liste séparée par des virgules pour une rotation sans coupure. */
export function metaAppSecrets(env: Env = process.env): string[] {
  return (env.META_APP_SECRET ?? '').split(',').map((value) => value.trim()).filter(Boolean);
}

export function webhookVerifyToken(env: Env = process.env): string | null {
  return env.META_WHATSAPP_VERIFY_TOKEN?.trim() || null;
}

/**
 * inline : le webhook traite les messages avant de répondre à Meta (tests,
 *          numéro de test, volumes faibles).
 * n8n    : le webhook persiste puis confie le traitement à n8n, qui rappelle
 *          POST /api/internal/whatsapp/process. Le balayage de maintenance
 *          reprend dans tous les cas les messages restés en attente.
 */
export type WhatsAppProcessingMode = 'inline' | 'n8n';

export function processingMode(env: Env = process.env): WhatsAppProcessingMode {
  return env.WHATSAPP_PROCESSING_MODE?.trim() === 'n8n' ? 'n8n' : 'inline';
}

/** Secret bearer des routes internes /api/internal/whatsapp/* (n8n). */
export function internalSecret(env: Env = process.env): string | null {
  return env.WHATSAPP_INTERNAL_SECRET?.trim() || null;
}

/**
 * Destinataires autorisés pour un tenant de test (tenants.is_test) : numéros
 * E.164 sans « + », séparés par des virgules. Variable absente = aucun envoi
 * sortant pour un tenant de test (même règle que TEST_TENANT_EMAIL_RECIPIENT).
 */
export function testRecipientAllowList(env: Env = process.env): string[] {
  return (env.WHATSAPP_TEST_RECIPIENTS ?? '')
    .split(',')
    .map((value) => value.replace(/[^0-9]/g, ''))
    .filter((value) => value.length >= 6);
}
