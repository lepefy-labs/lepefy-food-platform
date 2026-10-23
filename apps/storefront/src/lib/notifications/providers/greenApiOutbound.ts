/**
 * Green API outbound adapter for internal staff notifications (migration 158).
 *
 * Separate from the read-only catalog connector (lib/externalCatalog/providers/
 * greenApi.ts), which must never send. Methods, verified on the official
 * documentation (green-api.com/en/docs, 16/10/2026):
 *   POST {apiUrl}/waInstance{id}/sendMessage/{token}     { chatId, message } → { idMessage }
 *        message ≤ 20 000 characters; queued up to 24 h while the instance is not authorized
 *   GET  {apiUrl}/waInstance{id}/getStateInstance/{token} → { stateInstance }
 *        authorized | notAuthorized | blocked | sleepMode | starting | suspended | yellowCard (deprecated)
 *   POST {apiUrl}/waInstance{id}/getMessage/{token}      { chatId, idMessage } → { statusMessage }
 *        pending | sent | delivered | read | failed | yellowCard
 *   Errors: 400 (validation / instance starting or not authorized / expired),
 *   401/403 (credentials), 429 (rate), 466 (plan quota: the Developer plan
 *   allows 3 chats per month and per instance), 499/5xx.
 *
 * Rules:
 *   - server-side credentials only; the token sits in the URL path and is
 *     never logged nor returned (errors carry codes only);
 *   - chatId always `<digits>@c.us` from the E.164 number (one format: the
 *     plan counts a contact twice when both formats are used);
 *   - no idempotency at Green API: a timeout or a 2xx without id is
 *     `uncertain` and never retried automatically.
 */
import { isDemoDeployment } from '@/lib/demo/demoEnvironment';

export const GREEN_API_DELIVERY_PATH = '/whatsapp/send-message';
export const WHATSAPP_MESSAGE_MAX_LENGTH = 4000;

const ALLOWED_API_HOST_SUFFIXES = ['.green-api.com', '.greenapi.com'];
const DEFAULT_TIMEOUT_MS = 12_000;

export interface GreenApiOutboundConfig {
  apiUrl: string;
  idInstance: string;
  apiToken: string;
  /** dedicated = GREEN_API_NOTIFY_*; shared = the catalog instance (GREEN_API_*). */
  source: 'dedicated' | 'shared';
}

export type GreenApiConfigResult =
  | { ok: true; config: GreenApiOutboundConfig }
  | { ok: false; reason: 'missing' | 'invalid'; detail: string };

const DEDICATED = ['GREEN_API_NOTIFY_URL', 'GREEN_API_NOTIFY_INSTANCE_ID', 'GREEN_API_NOTIFY_TOKEN'] as const;
const SHARED = ['GREEN_API_URL', 'GREEN_API_INSTANCE_ID', 'GREEN_API_TOKEN'] as const;

/** Reads the credentials; failures name the variables, never their values. */
export function readGreenApiOutboundConfig(env: Record<string, string | undefined> = process.env): GreenApiConfigResult {
  const hasAll = (keys: readonly string[]) => keys.every((key) => env[key]?.trim());
  const keys = hasAll(DEDICATED) ? DEDICATED : hasAll(SHARED) ? SHARED : null;
  if (!keys) {
    const partial = DEDICATED.some((key) => env[key]?.trim());
    const missing = (partial ? DEDICATED : SHARED).filter((key) => !env[key]?.trim());
    return { ok: false, reason: 'missing', detail: missing.join(', ') };
  }
  const [urlKey, idKey, tokenKey] = keys;
  let parsed: URL;
  try { parsed = new URL(env[urlKey]!.trim()); } catch { return { ok: false, reason: 'invalid', detail: urlKey }; }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || (parsed.pathname !== '/' && parsed.pathname !== '')
    || !ALLOWED_API_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))) {
    return { ok: false, reason: 'invalid', detail: urlKey };
  }
  const idInstance = env[idKey]!.trim();
  const apiToken = env[tokenKey]!.trim();
  if (!/^\d{4,20}$/.test(idInstance)) return { ok: false, reason: 'invalid', detail: idKey };
  if (!/^[A-Za-z0-9]{8,200}$/.test(apiToken)) return { ok: false, reason: 'invalid', detail: tokenKey };
  return { ok: true, config: { apiUrl: `${parsed.protocol}//${parsed.host}`, idInstance, apiToken, source: keys === DEDICATED ? 'dedicated' : 'shared' } };
}

/** `+393331112222` → `393331112222@c.us`; null when not E.164. */
export function whatsappChatId(phone: string): string | null {
  return /^\+[1-9]\d{7,14}$/.test(phone) ? `${phone.slice(1)}@c.us` : null;
}

export interface GreenApiSendResult {
  ok: boolean;
  transport: 'green_api';
  messageId?: string | null;
  /** Code only (never the URL, the token or the provider body). */
  error?: string;
  httpStatus?: number;
  /** The request may have reached WhatsApp: never resend automatically. */
  uncertain?: boolean;
  /** Retrying cannot help (invalid number, plan quota…): abandon now. */
  definitive?: boolean;
}

export interface GreenApiDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function endpoint(config: GreenApiOutboundConfig, method: string) {
  return `${config.apiUrl}/waInstance${config.idInstance}/${method}/${config.apiToken}`;
}

/** Network failures that prove nothing left the machine. */
function notSentNetworkError(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'ERR_INVALID_URL'].includes(cause?.code ?? '');
}

async function readBodyText(response: Response): Promise<string> {
  try { return (await response.text()).slice(0, 2000); } catch { return ''; }
}

/** HTTP answer of sendMessage → outcome (pure, unit-tested). */
export function classifySendResponse(status: number, bodyText: string): GreenApiSendResult {
  const base = { transport: 'green_api' as const, httpStatus: status };
  if (status >= 200 && status < 300) {
    let id: unknown = null;
    try { id = (JSON.parse(bodyText) as { idMessage?: unknown }).idMessage; } catch { id = null; }
    return typeof id === 'string' && id.length > 0 && id.length <= 200
      ? { ...base, ok: true, messageId: id }
      : { ...base, ok: false, uncertain: true, error: 'green_api_no_message_id' };
  }
  const body = bodyText.toLowerCase();
  if (status === 466) return { ...base, ok: false, definitive: true, error: 'green_api_quota_exceeded' };
  if (status === 401 || status === 403) return { ...base, ok: false, error: `green_api_unauthorized_${status}` };
  if (status === 429) return { ...base, ok: false, error: 'green_api_rate_limited' };
  if (status === 499) return { ...base, ok: false, uncertain: true, error: 'green_api_client_closed' };
  if (status === 400) {
    if (body.includes('not authorized') || body.includes('starting')) return { ...base, ok: false, error: 'green_api_instance_not_authorized' };
    if (body.includes('expired')) return { ...base, ok: false, error: 'green_api_instance_expired' };
    if (body.includes('deleted')) return { ...base, ok: false, definitive: true, error: 'green_api_instance_deleted' };
    return { ...base, ok: false, definitive: true, error: 'green_api_invalid_request' };
  }
  if (status >= 500) return { ...base, ok: false, error: `green_api_http_${status}` };
  return { ...base, ok: false, error: `green_api_http_${status}` };
}

export async function sendGreenApiText(
  config: GreenApiOutboundConfig,
  input: { phone: string; message: string },
  deps: GreenApiDeps = {},
): Promise<GreenApiSendResult> {
  // Démo (docs/DEMO_EXPERIENCE.md) : aucun message réel ; échec définitif, jamais réessayé.
  if (isDemoDeployment()) return { ok: false, transport: 'green_api', definitive: true, error: 'demo_blocked' };
  const chatId = whatsappChatId(input.phone);
  if (!chatId) return { ok: false, transport: 'green_api', definitive: true, error: 'invalid_whatsapp_number' };
  const message = input.message.slice(0, WHATSAPP_MESSAGE_MAX_LENGTH);
  if (!message.trim()) return { ok: false, transport: 'green_api', definitive: true, error: 'empty_message' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (deps.fetch ?? fetch)(endpoint(config, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // linkPreview off: the admin link is the action, not a card.
      body: JSON.stringify({ chatId, message, linkPreview: false }),
      signal: controller.signal,
      cache: 'no-store',
    });
    return classifySendResponse(response.status, await readBodyText(response));
  } catch (error) {
    if (notSentNetworkError(error)) return { ok: false, transport: 'green_api', error: 'green_api_unreachable' };
    const aborted = (error as { name?: string } | null)?.name === 'AbortError';
    return { ok: false, transport: 'green_api', uncertain: true, error: aborted ? 'green_api_timeout' : 'green_api_network_error' };
  } finally {
    clearTimeout(timer);
  }
}

export type GreenApiInstanceState =
  | 'authorized' | 'notAuthorized' | 'blocked' | 'sleepMode' | 'starting' | 'suspended' | 'yellowCard' | 'unknown';

const STATES = new Set<GreenApiInstanceState>(['authorized', 'notAuthorized', 'blocked', 'sleepMode', 'starting', 'suspended', 'yellowCard']);

export async function getGreenApiInstanceState(config: GreenApiOutboundConfig, deps: GreenApiDeps = {}): Promise<{ ok: boolean; state: GreenApiInstanceState; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
  try {
    const response = await (deps.fetch ?? fetch)(endpoint(config, 'getStateInstance'), { method: 'GET', signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return { ok: false, state: 'unknown', error: `green_api_http_${response.status}` };
    const body = await response.json().catch(() => null) as { stateInstance?: unknown } | null;
    const state = typeof body?.stateInstance === 'string' && STATES.has(body.stateInstance as GreenApiInstanceState)
      ? body.stateInstance as GreenApiInstanceState : 'unknown';
    return { ok: state === 'authorized', state };
  } catch {
    return { ok: false, state: 'unknown', error: 'green_api_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

export type GreenApiMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed' | 'yellowCard';
const MESSAGE_STATUSES = new Set<GreenApiMessageStatus>(['pending', 'sent', 'delivered', 'read', 'failed', 'yellowCard']);

/** Observed status of an accepted message; null when the journal cannot tell. */
export async function getGreenApiMessageStatus(
  config: GreenApiOutboundConfig,
  input: { phone: string; messageId: string },
  deps: GreenApiDeps = {},
): Promise<GreenApiMessageStatus | null> {
  const chatId = whatsappChatId(input.phone);
  if (!chatId) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000);
  try {
    const response = await (deps.fetch ?? fetch)(endpoint(config, 'getMessage'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, idMessage: input.messageId }), signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null) as { statusMessage?: unknown } | null;
    return typeof body?.statusMessage === 'string' && MESSAGE_STATUSES.has(body.statusMessage as GreenApiMessageStatus)
      ? body.statusMessage as GreenApiMessageStatus : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** French explanation of an error code, for the platform console. */
export function greenApiErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const key = code.split(' ')[0]!;
  const labels: Record<string, string> = {
    green_api_quota_exceeded: 'Quota du forfait Green API atteint (forfait Developer : 3 conversations par mois et par instance).',
    green_api_unauthorized_401: 'Jeton Green API refusé : vérifier les variables d’environnement.',
    green_api_unauthorized_403: 'Instance Green API refusée : vérifier l’identifiant et l’URL.',
    green_api_rate_limited: 'Trop de requêtes : nouvel essai automatique plus tard.',
    green_api_instance_not_authorized: 'Instance WhatsApp Lepefy non connectée (scanner le QR code dans la console Green API).',
    green_api_instance_expired: 'Instance Green API expirée : renouveler l’abonnement.',
    green_api_instance_deleted: 'Instance Green API supprimée.',
    green_api_invalid_request: 'Requête refusée par Green API (numéro ou message invalide).',
    green_api_timeout: 'Pas de réponse à temps : le message a peut-être été envoyé. Vérifier avant de relancer.',
    green_api_network_error: 'Connexion interrompue : le message a peut-être été envoyé. Vérifier avant de relancer.',
    green_api_client_closed: 'Connexion fermée avant la réponse : le message a peut-être été envoyé.',
    green_api_no_message_id: 'Réponse sans identifiant de message : résultat incertain.',
    green_api_unreachable: 'Green API injoignable : nouvel essai automatique.',
    green_api_not_configured: 'Green API non configuré sur ce déploiement.',
    invalid_whatsapp_number: 'Numéro WhatsApp invalide.',
    whatsapp_disabled: 'Notifications WhatsApp désactivées pour cette boutique.',
    interrupted: 'Envoi interrompu : le message a peut-être été envoyé.',
    provider_failed: 'WhatsApp a signalé un échec d’envoi.',
  };
  return labels[key] ?? (key.startsWith('green_api_http_') ? `Erreur Green API (HTTP ${key.slice('green_api_http_'.length)}).` : null);
}
