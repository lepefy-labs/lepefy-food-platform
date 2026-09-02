import { expect, test } from '@playwright/test';
import {
  NALA_ATTRIBUTION_WINDOW_MS,
  nalaPurchaseIdempotencyKey,
  selectLatestNalaTouches,
  selectQualifyingNalaAttributions,
  type NalaProductTouch,
} from '../../src/lib/ai/nalaAttributionCore';

const NOW = Date.parse('2026-09-02T12:00:00.000Z');
const SESSION = '11111111-1111-4111-8111-111111111111';
const INTERACTION_OLD = '22222222-2222-4222-8222-222222222222';
const INTERACTION_NEW = '33333333-3333-4333-8333-333333333333';
const PRODUCT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORDER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function touch(interactionId: string, productIds: string[], ageMs: number): NalaProductTouch {
  return { interactionId, clientSessionId: SESSION, productIds, touchedAt: NOW - ageMs };
}

test('attribuisce solo lo stesso prodotto entro 30 minuti', async () => {
  expect(selectLatestNalaTouches([touch(INTERACTION_OLD, [PRODUCT_A], 1_000)], [PRODUCT_A], NOW))
    .toEqual([{ productId: PRODUCT_A, interactionId: INTERACTION_OLD, clientSessionId: SESSION }]);
  expect(selectLatestNalaTouches([touch(INTERACTION_OLD, [PRODUCT_A], 1_000)], [PRODUCT_B], NOW)).toEqual([]);
  expect(selectLatestNalaTouches(
    [touch(INTERACTION_OLD, [PRODUCT_A], NALA_ATTRIBUTION_WINDOW_MS + 1)],
    [PRODUCT_A],
    NOW,
  )).toEqual([]);
});

test('usa l’ultimo qualifying product touch e supporta carrelli misti', async () => {
  const result = selectLatestNalaTouches([
    touch(INTERACTION_OLD, [PRODUCT_A], 5_000),
    touch(INTERACTION_NEW, [PRODUCT_A], 1_000),
  ], [PRODUCT_A, PRODUCT_B], NOW);

  expect(result).toEqual([{ productId: PRODUCT_A, interactionId: INTERACTION_NEW, clientSessionId: SESSION }]);
});

test('il resolver server fail-closed rifiuta entitlement assente e mismatch retrieval', async () => {
  const interactions = [{
    id: INTERACTION_NEW,
    session_id: SESSION,
    matched_product_ids: [PRODUCT_A],
    client_session_id: SESSION,
    created_at: new Date(NOW - 1_000).toISOString(),
  }];
  const candidates = [{ productId: PRODUCT_A, interactionId: INTERACTION_NEW, clientSessionId: SESSION }];

  expect(selectQualifyingNalaAttributions({
    entitled: false, candidates, interactions, cartProductIds: [PRODUCT_A], nowMs: NOW,
  })).toEqual([]);
  expect(selectQualifyingNalaAttributions({
    entitled: true,
    candidates: [{ productId: PRODUCT_B, interactionId: INTERACTION_NEW, clientSessionId: SESSION }],
    interactions,
    cartProductIds: [PRODUCT_B],
    nowMs: NOW,
  })).toEqual([]);
});

test('la chiave purchase è stabile per retry e distinta per prodotto', async () => {
  expect(nalaPurchaseIdempotencyKey(ORDER, PRODUCT_A)).toBe(nalaPurchaseIdempotencyKey(ORDER, PRODUCT_A));
  expect(nalaPurchaseIdempotencyKey(ORDER, PRODUCT_A)).not.toBe(nalaPurchaseIdempotencyKey(ORDER, PRODUCT_B));
});
