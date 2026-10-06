import {
  WhatsAppProviderError,
  type WhatsAppMediaRef,
  type WhatsAppProvider,
  type WhatsAppProviderErrorKind,
  type WhatsAppSendResult,
  type WhatsAppTemplateComponent,
} from './types';

/**
 * Adaptateur WhatsApp Cloud API (Graph API). Seul module qui parle à
 * graph.facebook.com. Garanties :
 * - timeout par requête (AbortController) ;
 * - une seule nouvelle tentative, uniquement après une réponse HTTP explicite
 *   « temporaire » (5xx, limitation). Jamais après un timeout : la requête a pu
 *   être acceptée, la renvoyer risquerait un doublon chez le client ;
 * - erreurs classées et assainies (le jeton n'apparaît jamais).
 */

export interface MetaCloudProviderOptions {
  phoneNumberId: string;
  accessToken: string;
  apiVersion: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
}

const AUTH_CODES = new Set(['190', '102', '10', '3', '200']);
const RATE_LIMIT_CODES = new Set(['4', '17', '32', '613', '80007', '130429', '131048', '131056']);
const RECIPIENT_CODES = new Set(['131026', '131030', '131021', '131051', '131045']);
const TRANSIENT_CODES = new Set(['1', '2', '131000', '131016', '133004']);

export function classifyMetaError(httpStatus: number, code: string | null): WhatsAppProviderErrorKind {
  if (code === '131047') return 'outside_window';
  if (code && AUTH_CODES.has(code)) return 'auth';
  if (code && /^2\d\d$/.test(code)) return 'auth';
  if (code && RATE_LIMIT_CODES.has(code)) return 'rate_limit';
  if (code && RECIPIENT_CODES.has(code)) return 'recipient';
  if (code && TRANSIENT_CODES.has(code)) return 'transient';
  if (httpStatus === 429) return 'rate_limit';
  if (httpStatus === 401 || httpStatus === 403) return 'auth';
  if (httpStatus >= 500) return 'transient';
  if (httpStatus >= 400) return 'invalid_request';
  return 'unknown';
}

/** Message d'erreur borné, sans rien qui ressemble à un jeton ou à un numéro. */
export function sanitizeProviderMessage(message: unknown): string {
  if (typeof message !== 'string') return 'provider_error';
  return message
    .replace(/EAA[A-Za-z0-9]{10,}/g, '[token]')
    .replace(/\b(?:access_token|Bearer)\s*[=:]?\s*\S+/gi, '[credential]')
    .replace(/\+?\d{8,}/g, '[number]')
    .slice(0, 200);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createMetaCloudProvider(options: MetaCloudProviderOptions): WhatsAppProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const endpoint = `${(options.baseUrl ?? 'https://graph.facebook.com').replace(/\/$/, '')}/${options.apiVersion}/${options.phoneNumberId}/messages`;

  async function attempt(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new WhatsAppProviderError({ kind: aborted ? 'timeout' : 'unknown', message: aborted ? 'timeout' : 'network_error' });
    } finally {
      clearTimeout(timer);
    }

    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.ok) return json ?? {};
    const error = (json?.error ?? null) as { code?: unknown; error_subcode?: unknown; message?: unknown } | null;
    const code = error?.code != null ? String(error.code).slice(0, 32) : null;
    throw new WhatsAppProviderError({
      kind: classifyMetaError(response.status, code),
      code,
      httpStatus: response.status,
      message: sanitizeProviderMessage(error?.message),
    });
  }

  async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      return await attempt(body);
    } catch (error) {
      if (error instanceof WhatsAppProviderError && error.retryable && error.httpStatus !== null) {
        await sleep(error.kind === 'rate_limit' ? 1500 : 500);
        return attempt(body);
      }
      throw error;
    }
  }

  async function send(to: string, type: string, payload: Record<string, unknown>, context?: string): Promise<WhatsAppSendResult> {
    const recipient = to.replace(/[^0-9]/g, '');
    if (recipient.length < 6) throw new WhatsAppProviderError({ kind: 'recipient', message: 'invalid_recipient' });
    const json = await post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type,
      ...(context ? { context: { message_id: context } } : {}),
      [type]: payload,
    });
    const id = (json.messages as Array<{ id?: unknown }> | undefined)?.[0]?.id;
    if (typeof id !== 'string' || id.length < 8) throw new WhatsAppProviderError({ kind: 'unknown', message: 'missing_message_id' });
    return { providerMessageId: id };
  }

  function media(ref: WhatsAppMediaRef): Record<string, unknown> {
    if (ref.id) return { id: ref.id };
    if (ref.link && /^https:\/\//.test(ref.link)) return { link: ref.link };
    throw new WhatsAppProviderError({ kind: 'invalid_request', message: 'invalid_media' });
  }

  return {
    kind: 'meta_cloud',
    sendText: (to, body, opts) => send(to, 'text', { body: body.slice(0, 4096), preview_url: opts?.previewUrl ?? false }, opts?.replyTo),
    sendTemplate: (to, name, languageCode, components?: WhatsAppTemplateComponent[]) => send(to, 'template', {
      name, language: { code: languageCode }, ...(components?.length ? { components } : {}),
    }),
    sendInteractive: (to, interactive) => send(to, 'interactive', interactive),
    sendImage: (to, image) => send(to, 'image', { ...media(image), ...(image.caption ? { caption: image.caption.slice(0, 1024) } : {}) }),
    sendDocument: (to, document) => send(to, 'document', {
      ...media(document),
      ...(document.filename ? { filename: document.filename.slice(0, 240) } : {}),
      ...(document.caption ? { caption: document.caption.slice(0, 1024) } : {}),
    }),
    markAsRead: async (providerMessageId) => {
      await post({ messaging_product: 'whatsapp', status: 'read', message_id: providerMessageId });
    },
  };
}
