import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Vérifications officielles Meta :
 * - GET : poignée de main d'abonnement (hub.mode / hub.verify_token / hub.challenge) ;
 * - POST : X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, corps brut).
 * Comparaisons en temps constant ; aucun secret n'est renvoyé ni journalisé.
 */

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type SubscriptionVerification =
  | { ok: true; challenge: string }
  | { ok: false; status: 400 | 403 | 503 };

export function verifySubscriptionRequest(params: URLSearchParams, expectedToken: string | null): SubscriptionVerification {
  if (!expectedToken) return { ok: false, status: 503 };
  const mode = params.get('hub.mode');
  const token = params.get('hub.verify_token');
  const challenge = params.get('hub.challenge');
  if (mode !== 'subscribe' || !token || !challenge) return { ok: false, status: 400 };
  // Le challenge est renvoyé tel quel en texte : on n'accepte qu'un jeton court et sans balisage.
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(challenge)) return { ok: false, status: 400 };
  return safeEqual(token, expectedToken) ? { ok: true, challenge } : { ok: false, status: 403 };
}

export function computeMetaSignature(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

/** true si l'en-tête correspond à l'un des secrets configurés (rotation). */
export function verifyMetaSignature(rawBody: Buffer | string, header: string | null, appSecrets: string[]): boolean {
  if (!header || appSecrets.length === 0) return false;
  const provided = header.trim().toLowerCase();
  if (!/^sha256=[0-9a-f]{64}$/.test(provided)) return false;
  return appSecrets.some((secret) => safeEqual(provided, computeMetaSignature(rawBody, secret)));
}
