'use client';

import {
  isUuid,
  selectLatestNalaTouches,
  type NalaAttributionCandidate,
  type NalaProductTouch,
} from '@/lib/ai/nalaAttributionCore';

const STORAGE_KEY = 'lepefy-nala-attribution-v1';
const MAX_TOUCHES = 12;
const MAX_PRODUCTS_PER_TOUCH = 12;

function readTouches(): NalaProductTouch[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTouches(touches: NalaProductTouch[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(touches.slice(-MAX_TOUCHES)));
  } catch {
    // Attribution storage is best-effort and never affects shopping.
  }
}

export function rememberNalaProductTouch(params: {
  interactionId: unknown;
  clientSessionId: unknown;
  matchedProductIds: unknown;
}): void {
  if (!isUuid(params.interactionId) || !isUuid(params.clientSessionId)) return;
  if (!Array.isArray(params.matchedProductIds)) return;

  const productIds = [...new Set(params.matchedProductIds.filter(isUuid))].slice(0, MAX_PRODUCTS_PER_TOUCH);
  if (productIds.length === 0) return;

  const now = Date.now();
  const active = readTouches().filter((touch) => (
    Number.isFinite(touch.touchedAt) && now - touch.touchedAt <= 30 * 60 * 1000
  ));
  active.push({
    interactionId: params.interactionId,
    clientSessionId: params.clientSessionId,
    productIds,
    touchedAt: now,
  });
  writeTouches(active);
}

export function buildNalaCheckoutAttributions(
  items: Array<{ product: { id: string } }>,
): NalaAttributionCandidate[] {
  return selectLatestNalaTouches(readTouches(), items.map((item) => item.product.id));
}

function createIdempotencyKey(): string | null {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') return null;
  return crypto.randomUUID();
}

export async function trackNalaAddToCart(productId: string, quantity: number): Promise<void> {
  if (typeof window === 'undefined' || !isUuid(productId)) return;
  const [candidate] = selectLatestNalaTouches(readTouches(), [productId]);
  const idempotencyKey = createIdempotencyKey();
  if (!candidate || !idempotencyKey) return;

  try {
    await fetch('/api/nala/attribution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'add_to_cart',
        productId,
        interactionId: candidate.interactionId,
        clientSessionId: candidate.clientSessionId,
        quantity,
        idempotencyKey,
      }),
      keepalive: true,
    });
  } catch {
    // Conversion analytics is deliberately isolated from cart behavior.
  }
}
