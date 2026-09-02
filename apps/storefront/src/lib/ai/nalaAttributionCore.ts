export const NALA_ATTRIBUTION_WINDOW_MS = 30 * 60 * 1000;
export const NALA_ATTRIBUTION_MODEL = 'nala_last_product_touch_v1';

export interface NalaAttributionCandidate {
  productId: string;
  interactionId: string;
  clientSessionId: string;
}

export interface NalaProductTouch {
  interactionId: string;
  clientSessionId: string;
  productIds: string[];
  touchedAt: number;
}

export interface NalaInteractionSnapshot {
  id: string;
  session_id: string;
  matched_product_ids: string[] | null;
  client_session_id: string;
  created_at: string;
}

export interface ResolvedNalaAttribution {
  productId: string;
  interactionId: string;
  sessionId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function selectLatestNalaTouches(
  touches: NalaProductTouch[],
  productIds: string[],
  nowMs: number = Date.now(),
): NalaAttributionCandidate[] {
  const requested = new Set(productIds.filter(isUuid));
  const selected = new Map<string, NalaProductTouch>();

  for (const touch of touches) {
    if (!isUuid(touch.interactionId) || !isUuid(touch.clientSessionId)) continue;
    if (!Number.isFinite(touch.touchedAt) || touch.touchedAt > nowMs) continue;
    if (nowMs - touch.touchedAt > NALA_ATTRIBUTION_WINDOW_MS) continue;

    for (const productId of touch.productIds) {
      if (!requested.has(productId)) continue;
      const current = selected.get(productId);
      if (!current || current.touchedAt < touch.touchedAt) selected.set(productId, touch);
    }
  }

  return [...selected.entries()].map(([productId, touch]) => ({
    productId,
    interactionId: touch.interactionId,
    clientSessionId: touch.clientSessionId,
  }));
}

export function selectQualifyingNalaAttributions(params: {
  entitled: boolean;
  candidates: NalaAttributionCandidate[];
  interactions: NalaInteractionSnapshot[];
  cartProductIds: string[];
  nowMs?: number;
}): ResolvedNalaAttribution[] {
  if (!params.entitled) return [];

  const nowMs = params.nowMs ?? Date.now();
  const cartProducts = new Set(params.cartProductIds.filter(isUuid));
  const interactions = new Map(params.interactions.map((interaction) => [interaction.id, interaction]));
  const selected = new Map<string, { attribution: ResolvedNalaAttribution; createdAt: number }>();

  for (const candidate of params.candidates) {
    if (!isUuid(candidate.productId) || !isUuid(candidate.interactionId) || !isUuid(candidate.clientSessionId)) continue;
    if (!cartProducts.has(candidate.productId)) continue;

    const interaction = interactions.get(candidate.interactionId);
    if (!interaction || !isUuid(interaction.session_id)) continue;
    if (interaction.client_session_id !== candidate.clientSessionId) continue;
    if (!interaction.matched_product_ids?.includes(candidate.productId)) continue;

    const createdAt = Date.parse(interaction.created_at);
    if (!Number.isFinite(createdAt) || createdAt > nowMs) continue;
    if (nowMs - createdAt > NALA_ATTRIBUTION_WINDOW_MS) continue;

    const current = selected.get(candidate.productId);
    if (!current || current.createdAt < createdAt) {
      selected.set(candidate.productId, {
        createdAt,
        attribution: {
          productId: candidate.productId,
          interactionId: interaction.id,
          sessionId: interaction.session_id,
        },
      });
    }
  }

  return [...selected.values()].map(({ attribution }) => attribution);
}

export function nalaPurchaseIdempotencyKey(orderId: string, productId: string): string {
  return `purchase:${orderId}:${productId}`;
}
