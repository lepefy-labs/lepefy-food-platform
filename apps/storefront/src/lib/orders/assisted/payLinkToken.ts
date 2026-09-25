import crypto from 'crypto';

/**
 * Jeton opaque des liens /pay/<token>.
 *
 * token = base64url(HMAC-SHA256(TRACKING_SECRET, "pay:<sessionId>:<nonce>"))
 *
 * - imprévisible : nécessite le secret serveur ET le nonce aléatoire stocké ;
 * - révocable : remplacer le nonce (et son hash) invalide immédiatement l'ancien lien ;
 * - recopiable : l'admin peut réafficher le lien courant sans le stocker en clair ;
 * - la recherche publique se fait uniquement par SHA-256(token) (colonne unique).
 *
 * Même secret que les jetons de suivi/accès existants — aucun nouveau secret.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newPayLinkNonce(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function derivePayLinkToken(sessionId: string, nonce: string, secret = process.env.TRACKING_SECRET): string | null {
  if (!secret || !nonce) return null;
  return crypto.createHmac('sha256', secret).update(`pay:${sessionId}:${nonce}`).digest('base64url');
}

export function hashPayLinkToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function isWellFormedPayLinkToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}
