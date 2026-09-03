import { AiAttemptError, type LepefyAiProviderAdapter } from '../types';

/** Explicit deployment allowlist prevents registry edits from becoming an arbitrary HTTP proxy. */
export function approvedInferenceUrl(base: string | null): string {
  if (!base) throw new AiAttemptError('model_unavailable');
  const url = new URL(base);
  const allowed = (process.env.LEPEFY_AI_ALLOWED_ORIGINS ?? '').split(',').map(v => v.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !allowed.includes(url.origin)) throw new AiAttemptError('unapproved_endpoint');
  return url.toString().replace(/\/$/, '') + '/chat/completions';
}

export function providerHttpFailureCode(status: number): string {
  if (status === 429) return 'rate_limit';
  if (status === 400) return 'provider_http_400';
  if (status === 401) return 'provider_http_401';
  if (status === 403) return 'provider_http_403';
  if (status === 404) return 'provider_http_404';
  if (status >= 500 && status <= 599) return 'provider_http_5xx';
  return 'provider_error';
}

export const openaiCompatibleAdapter: LepefyAiProviderAdapter = {
  async generate(request) {
    const response = await fetch(approvedInferenceUrl(request.provider.base_url), {
      method: 'POST', redirect: 'error', signal: request.signal,
      headers: { 'Content-Type': 'application/json',
        ...(request.credential ? { Authorization: `Bearer ${request.credential}` } : {}) },
      body: JSON.stringify({
        model: request.model.provider_model_id,
        messages: [{ role: 'system', content: request.system + '\nReturn JSON matching this schema: ' + JSON.stringify(request.responseSchema) }, ...request.messages],
        temperature: request.temperature ?? 0.4, max_tokens: request.maxOutputTokens ?? 1200,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new AiAttemptError(providerHttpFailureCode(response.status));
    const data = await response.json();
    return {
      text: typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : '',
      inputTokens: data?.usage?.prompt_tokens, outputTokens: data?.usage?.completion_tokens,
    };
  },
};
