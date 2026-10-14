/**
 * Relance d'un panier non finalisé.
 *
 *   - session encore ouverte : le lien « Reprendre mon achat » existant
 *     (`/checkout/reprendre/[id]`) ;
 *   - session expirée (cas courant d'un panier carte) : un lien signé vers
 *     `/panier/retrouver/[id]` qui remet les articles dans le panier, à prix et
 *     stock du jour (aucun prix garanti), valable `COMEBACK_WINDOW_DAYS` jours
 *     après la création du panier.
 *
 * Le lien est un HMAC (TRACKING_SECRET) distinct de celui de reprise : il ne
 * donne accès qu'à la liste des articles, jamais aux coordonnées ni au paiement.
 */
import crypto from 'crypto';
import { getMaximumValidQuantity, normalizeQuantityForStock, repairQuantity } from '../purchaseQuantityRules';

export const COMEBACK_WINDOW_DAYS = 14;
const COMEBACK_PURPOSE = 'cart-comeback';

export function generateCartComebackToken(sessionId: string, email: string): string {
  return crypto.createHmac('sha256', process.env.TRACKING_SECRET!).update(`${COMEBACK_PURPOSE}:${sessionId}:${email.toLowerCase()}`).digest('hex');
}

export function isValidCartComebackToken(sessionId: string, email: string, token: string | null | undefined): boolean {
  if (!process.env.TRACKING_SECRET || !token || !/^[0-9a-f]{64}$/i.test(token)) return false;
  const expected = generateCartComebackToken(sessionId, email);
  return crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
}

/** Le lien « retrouver mon panier » est encore valable pour ce panier. */
export function isWithinComebackWindow(createdAt: string, now: Date = new Date()): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now.getTime() - created <= COMEBACK_WINDOW_DAYS * 86_400_000;
}

export type CartRecoveryMode = 'resume' | 'comeback' | 'none';

export interface CartRecoverySession {
  status: string;
  payment_method: string;
  expires_at: string;
  created_at: string;
  order_id: string | null;
}

/**
 * Quelle relance proposer. Paiement externe : uniquement la reprise (règles
 * actuelles inchangées). Carte : reprise si la session est encore ouverte,
 * sinon « retrouver mon panier » dans la fenêtre de 14 jours.
 */
export function cartRecoveryMode(session: CartRecoverySession, now: Date = new Date()): CartRecoveryMode {
  if (session.order_id) return 'none';
  const open = session.status === 'open' && Date.parse(session.expires_at) > now.getTime();
  if (session.payment_method === 'external_link') {
    return open || session.status === 'awaiting_verification' ? 'resume' : 'none';
  }
  if (session.payment_method !== 'stripe') return 'none';
  if (open) return 'resume';
  if ((session.status === 'open' || session.status === 'expired') && isWithinComebackWindow(session.created_at, now)) return 'comeback';
  return 'none';
}

export interface ComebackSessionItem {
  productId?: string | null;
  name: string;
  quantity: number;
  price: number;
}

export interface ComebackProduct {
  id: string;
  name: string;
  price: number;
  stock: number | null;
  min_order_quantity: number;
  order_quantity_step: number;
}

export interface ComebackLine<P extends ComebackProduct = ComebackProduct> {
  name: string;
  /** Produit actuel (null = plus vendu). */
  product: P | null;
  /** Quantité remise dans le panier (0 = indisponible). */
  quantity: number;
  previousQuantity: number;
  /** Quantité ajustée (stock, minimum ou pas changés depuis). */
  adjusted: boolean;
  unitPrice: number | null;
}

/**
 * Lignes à remettre dans le panier : produits actuels du tenant, quantités
 * ramenées à une valeur achetable aujourd'hui (stock, minimum, pas), produits
 * retirés ou épuisés signalés. Les prix sont ceux du jour.
 */
export function rebuildCartLines<P extends ComebackProduct>(items: readonly ComebackSessionItem[], products: readonly P[]): ComebackLine<P>[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  return items.map((item) => {
    const product = item.productId ? byId.get(item.productId) ?? null : null;
    const previousQuantity = Math.max(0, Math.trunc(Number(item.quantity)) || 0);
    if (!product) return { name: item.name, product: null, quantity: 0, previousQuantity, adjusted: false, unitPrice: null };
    const stock = product.stock ?? 999;
    const minimum = product.min_order_quantity || 1;
    const step = product.order_quantity_step || 1;
    if (getMaximumValidQuantity(stock, minimum, step) === 0) {
      return { name: product.name, product, quantity: 0, previousQuantity, adjusted: false, unitPrice: Number(product.price) };
    }
    const quantity = normalizeQuantityForStock(previousQuantity, stock, minimum, step) || repairQuantity(previousQuantity, stock, minimum, step);
    return { name: product.name, product, quantity, previousQuantity, adjusted: quantity !== previousQuantity, unitPrice: Number(product.price) };
  });
}
