import 'server-only';
import { httpStatusError, StudioProviderError, type ImageStudioProvider } from './types';

/**
 * OpenAI Images API (gpt-image family): `/v1/images/edits` with the photo,
 * `/v1/images/generations` from text. Base URL fixed to api.openai.com unless
 * the provider row sets an HTTPS origin (same rule as AI Core: no credential
 * in the URL, no redirect).
 */
const DEFAULT_BASE = 'https://api.openai.com';

function baseUrl(value: string | null): string {
  if (!value) return DEFAULT_BASE;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new StudioProviderError('model_unavailable');
  return url.origin;
}

export const openaiImageProvider: ImageStudioProvider = {
  async run(request, model, credential) {
    const origin = baseUrl(model.baseUrl);
    let response: Response;
    try {
      if (request.input) {
        const form = new FormData();
        form.append('model', model.providerModelId);
        form.append('prompt', request.prompt);
        form.append('size', '1024x1024');
        form.append('n', '1');
        const extension = request.input.mime === 'image/png' ? 'png' : request.input.mime === 'image/webp' ? 'webp' : 'jpg';
        form.append('image', new Blob([new Uint8Array(request.input.bytes)], { type: request.input.mime }), 'input.' + extension);
        response = await fetch(origin + '/v1/images/edits', {
          method: 'POST', headers: { Authorization: 'Bearer ' + credential }, body: form, signal: request.signal, redirect: 'error',
        });
      } else {
        response = await fetch(origin + '/v1/images/generations', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + credential, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.providerModelId, prompt: request.prompt, size: '1024x1024', n: 1 }),
          signal: request.signal,
          redirect: 'error',
        });
      }
    } catch {
      if (request.signal.aborted) throw new StudioProviderError('provider_timeout');
      throw new StudioProviderError('provider_error');
    }

    const body = await response.json().catch(() => null) as {
      data?: Array<{ b64_json?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      error?: { code?: string; type?: string };
    } | null;
    if (!response.ok) {
      const code = body?.error?.code ?? '';
      if (/moderation|safety|content_policy/.test(code)) throw new StudioProviderError('safety_blocked');
      throw httpStatusError(response.status, body?.error?.code ?? '');
    }
    const data = body?.data?.[0]?.b64_json;
    if (!data) throw new StudioProviderError('no_image');
    return {
      bytes: Buffer.from(data, 'base64'),
      mime: 'image/png',
      inputTokens: body?.usage?.input_tokens,
      outputTokens: body?.usage?.output_tokens,
      images: 1,
    };
  },
};
