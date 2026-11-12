/**
 * Image provider contract of the Studio. The admin flow only knows this
 * interface: switching provider = changing the AI Core routing policy
 * `studio/photo_edit` or `studio/prompt_generate` (/admin/platform/ai-routing),
 * never the flow. Credentials are read from the env var named by the provider
 * row (`credential_ref`), never stored.
 */

export type StudioCapability = 'photo_edit' | 'prompt_generate';

export interface StudioImageRequest {
  capability: StudioCapability;
  prompt: string;
  /** Photo to edit (original or the proposal being corrected). */
  input: { bytes: Buffer; mime: string } | null;
  /** Requested output ratio when the provider supports it. */
  aspectRatio: '1:1';
  signal: AbortSignal;
}

export interface StudioImageResult {
  bytes: Buffer;
  mime: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Provider-reported flat image count (cost by image). */
  images?: number;
}

export interface StudioModelRef {
  /** ai_models.key */
  key: string;
  /** Model id sent to the provider. */
  providerModelId: string;
  providerKey: string;
  providerType: string;
  baseUrl: string | null;
}

export interface ImageStudioProvider {
  run(request: StudioImageRequest, model: StudioModelRef, credential: string): Promise<StudioImageResult>;
}

/** Normalised failure: the code is stored and mapped to a French message. */
export class StudioProviderError extends Error {
  /** Provider HTTP status and a short message, for the server log only (never shown, never a secret). */
  detail: string | null = null;
  constructor(public code: 'provider_timeout' | 'rate_limit' | 'provider_billing' | 'safety_blocked' | 'no_image' | 'provider_error' | 'model_unavailable' | 'missing_credential' | 'invalid_output' | 'no_enabled_model') {
    super(code);
    this.name = 'StudioProviderError';
  }
}

export function httpStatusError(status: number | undefined, message?: unknown): StudioProviderError {
  const error = status === 402 ? new StudioProviderError('provider_billing')
    : status === 429 ? new StudioProviderError('rate_limit')
    : status === 404 ? new StudioProviderError('model_unavailable')
      : status === 401 || status === 403 ? new StudioProviderError('missing_credential')
        : new StudioProviderError('provider_error');
  const text = typeof message === 'string' ? message : message instanceof Error ? message.message : '';
  // Keys are never in provider messages; still strip anything that looks like one.
  error.detail = `${status ?? 'no-status'} ${text.replace(/AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z_-]{20,}/g, '[key]').slice(0, 200)}`;
  return error;
}
