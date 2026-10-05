import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Jeton opaque du portail commande `/o/<token>` (QR du bon de colis).
 *
 * token = base64url(HMAC-SHA256(TRACKING_SECRET, "order-portal:<rowId>:<nonce>")[0..16])
 *
 * - 128 bits, 22 caractères, sans donnée personnelle ni UUID de commande ;
 * - imprévisible et non énumérable : il faut le secret serveur ET le nonce
 *   aléatoire de la ligne ;
 * - la base ne stocke que le nonce et SHA-256(token) (recherche publique par
 *   hash, unique par tenant) : jamais le jeton en clair ;
 * - réimprimable : le même jeton est redérivé à chaque bon de colis ;
 * - révocable : `revoked_at` ; le bon suivant reçoit un nouveau jeton.
 *
 * Même secret que les liens de suivi et /pay (aucun nouveau secret) : sa
 * rotation invalide les QR déjà imprimés. Le jeton n'est jamais journalisé.
 */
export const ORDER_PORTAL_PURPOSE = 'order_portal';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TABLE = 'order_public_access_tokens';

export class PortalTokenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PortalTokenUnavailableError';
  }
}

export function newPortalTokenNonce(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function derivePortalToken(rowId: string, nonce: string, secret = process.env.TRACKING_SECRET): string | null {
  if (!secret || !rowId || !nonce) return null;
  return crypto.createHmac('sha256', secret).update(`order-portal:${rowId}:${nonce}`).digest().subarray(0, 16).toString('base64url');
}

export function hashPortalToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function isWellFormedPortalToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/** URL publique construite sur l'URL canonique du tenant (jamais l'en-tête Host). */
export function orderPortalUrl(shopBaseUrl: string, token: string): string {
  return `${shopBaseUrl.replace(/\/+$/, '')}/o/${token}`;
}

/** URL lisible imprimée sous le QR (sans protocole). */
export function orderPortalDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '');
}

interface TokenRow {
  id: string;
  order_id: string;
  token_nonce: string;
  token_hash: string;
  revoked_at: string | null;
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return Boolean(error && (error.code === '42P01' || error.code === 'PGRST205' || /order_public_access_tokens/.test(error.message ?? '')));
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * Jeton actif de chaque commande, créé paresseusement (premier bon de colis).
 * Lecture et insertion en lot (pas de N+1). Une course entre deux impressions
 * est absorbée par l'index unique partiel « un jeton actif par commande ».
 * Les commandes doivent déjà avoir été vérifiées comme appartenant au tenant.
 */
export async function getOrCreateOrderPublicTokens(
  db: SupabaseClient,
  tenantId: string,
  orderIds: string[],
  secret = process.env.TRACKING_SECRET,
): Promise<Map<string, string>> {
  if (!secret) throw new PortalTokenUnavailableError('TRACKING_SECRET manquant');
  const ids = Array.from(new Set(orderIds));
  const tokens = new Map<string, string>();
  if (ids.length === 0) return tokens;

  const readActive = async () => {
    const { data, error } = await db.from(TABLE)
      .select('id, order_id, token_nonce, token_hash, revoked_at')
      .eq('tenant_id', tenantId).eq('purpose', ORDER_PORTAL_PURPOSE).is('revoked_at', null).in('order_id', ids);
    if (error) throw isMissingTable(error) ? new PortalTokenUnavailableError('migration 145 non appliquée') : new Error(`order token read failed: ${error.code ?? ''}`);
    return (data ?? []) as TokenRow[];
  };

  const stale: string[] = [];
  for (const row of await readActive()) {
    const token = derivePortalToken(row.id, row.token_nonce, secret);
    // Secret changé depuis l'émission : l'ancien QR est déjà invalide, on le révoque.
    if (!token || !safeEqual(hashPortalToken(token), row.token_hash)) { stale.push(row.id); continue; }
    tokens.set(row.order_id, token);
  }
  if (stale.length > 0) {
    await db.from(TABLE).update({ revoked_at: new Date().toISOString() }).eq('tenant_id', tenantId).in('id', stale);
  }

  const missing = ids.filter((id) => !tokens.has(id));
  if (missing.length === 0) return tokens;

  const rows = missing.map((orderId) => {
    const id = crypto.randomUUID();
    const nonce = newPortalTokenNonce();
    const token = derivePortalToken(id, nonce, secret)!;
    return { row: { id, tenant_id: tenantId, order_id: orderId, purpose: ORDER_PORTAL_PURPOSE, token_nonce: nonce, token_hash: hashPortalToken(token) }, token };
  });
  const { error } = await db.from(TABLE).insert(rows.map((r) => r.row));
  if (!error) {
    for (const { row, token } of rows) tokens.set(row.order_id, token);
    return tokens;
  }
  if (isMissingTable(error)) throw new PortalTokenUnavailableError('migration 145 non appliquée');
  if (error.code !== '23505') throw new Error(`order token insert failed: ${error.code ?? ''}`);

  // Impression concurrente : on insère ligne par ligne ce qui manque encore.
  for (const row of await readActive()) {
    const token = derivePortalToken(row.id, row.token_nonce, secret);
    if (token && safeEqual(hashPortalToken(token), row.token_hash)) tokens.set(row.order_id, token);
  }
  for (const { row, token } of rows) {
    if (tokens.has(row.order_id)) continue;
    const { error: retryError } = await db.from(TABLE).insert(row);
    if (!retryError) tokens.set(row.order_id, token);
  }
  return tokens;
}

/**
 * Résolution publique, côté serveur uniquement. Jeton mal formé, inconnu,
 * révoqué ou d'un autre tenant → null (la page répond le même 404).
 */
export async function resolveOrderPublicToken(
  db: SupabaseClient,
  tenantId: string,
  token: unknown,
  secret = process.env.TRACKING_SECRET,
): Promise<{ orderId: string; tokenId: string } | null> {
  if (!secret || !isWellFormedPortalToken(token)) return null;
  const { data, error } = await db.from(TABLE)
    .select('id, order_id, token_nonce, token_hash, revoked_at')
    .eq('tenant_id', tenantId).eq('purpose', ORDER_PORTAL_PURPOSE).eq('token_hash', hashPortalToken(token))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as TokenRow;
  if (row.revoked_at) return null;
  const expected = derivePortalToken(row.id, row.token_nonce, secret);
  if (!expected || !safeEqual(expected, token)) return null;
  return { orderId: row.order_id, tokenId: row.id };
}

/** Révocation (modèle prêt, sans UI pour l'instant). */
export async function revokeOrderPublicTokens(db: SupabaseClient, tenantId: string, orderId: string): Promise<void> {
  const { error } = await db.from(TABLE).update({ revoked_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('order_id', orderId).is('revoked_at', null);
  if (error) throw new Error(`order token revoke failed: ${error.code ?? ''}`);
}
