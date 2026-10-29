import { base64ToBytes, bytesToBase64, constantTimeEqual, hmacSha256, utf8 } from './encoding';

/**
 * Standard Webhooks verification (the scheme Supabase signs Auth Hooks with):
 * HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${body}`, header
 * `webhook-signature` = space separated `v1,<base64>` entries.
 * Secret format from the dashboard: `v1,whsec_<base64>`.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookVerdict =
  | { ok: true; webhookId: string }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'timestamp_out_of_tolerance' | 'bad_secret' | 'bad_signature' };

export function decodeWebhookSecret(secret: string): Uint8Array | null {
  const raw = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
  try {
    const bytes = base64ToBytes(raw);
    return bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export async function signWebhook(secret: string, id: string, timestamp: string, body: string): Promise<string | null> {
  const key = decodeWebhookSecret(secret);
  if (!key) return null;
  const sig = await hmacSha256(key, utf8(`${id}.${timestamp}.${body}`));
  return `v1,${bytesToBase64(sig)}`;
}

export async function verifyWebhook(
  secret: string,
  headers: { get(name: string): string | null },
  body: string,
  nowSeconds: number,
): Promise<WebhookVerdict> {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signature = headers.get('webhook-signature');
  if (!id || !timestamp || !signature) return { ok: false, reason: 'missing_headers' };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: 'bad_timestamp' };
  if (Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return { ok: false, reason: 'timestamp_out_of_tolerance' };

  const expected = await signWebhook(secret, id, timestamp, body);
  if (!expected) return { ok: false, reason: 'bad_secret' };
  const expectedBytes = utf8(expected);

  for (const candidate of signature.split(' ')) {
    if (constantTimeEqual(utf8(candidate), expectedBytes)) return { ok: true, webhookId: id };
  }
  return { ok: false, reason: 'bad_signature' };
}
