export interface OutgoingMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Stable per (hook call, recipient): Resend de-duplicates a Supabase retry of the same call. */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; code: string; retryable: boolean };

export type MailTransport = (mail: OutgoingMail) => Promise<SendResult>;

export const PROVIDER_TIMEOUT_MS = 4000;

/**
 * Resend adapter (first and only provider). Success is returned only when Resend
 * answers 2xx with a message id, i.e. the provider ACCEPTED the message:
 * that is not delivery. The error `code` never contains provider text.
 */
export function createResendTransport(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = PROVIDER_TIMEOUT_MS,
): MailTransport {
  return async (mail) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': mail.idempotencyKey,
        },
        body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
        signal: controller.signal,
      });
      if (res.ok) {
        const json = (await res.json().catch(() => null)) as { id?: unknown } | null;
        const id = typeof json?.id === 'string' ? json.id : null;
        // 2xx without a message id: acceptance is not confirmed.
        return id ? { ok: true, providerMessageId: id } : { ok: false, code: 'provider_no_message_id', retryable: false };
      }
      return { ok: false, code: `provider_http_${res.status}`, retryable: res.status === 429 || res.status >= 500 };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return { ok: false, code: aborted ? 'provider_timeout' : 'provider_unreachable', retryable: true };
    } finally {
      clearTimeout(timer);
    }
  };
}
