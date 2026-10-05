import { expect, test } from '@playwright/test';
import { actionsFor, flagLabel, moderationIssues, publicRatingState, REASON_LABELS } from '../../src/lib/reviews/reviewAdmin';
import { REVIEW_REASON_CODES } from '../../src/lib/reviews/reviewModeration';

test('actions per status', () => {
  expect(actionsFor('pending_moderation')).toEqual(['publish', 'reject']);
  expect(actionsFor('published')).toEqual(['hide']);
  expect(actionsFor('rejected')).toEqual(['restore']);
  expect(actionsFor('hidden')).toEqual(['restore']);
});

test('reject and hide need a reason, « Autre » needs a precision', () => {
  expect(moderationIssues('publish', null, null)).toEqual([]);
  expect(moderationIssues('reject', null, null)).toHaveLength(1);
  expect(moderationIssues('hide', 'spam', null)).toEqual([]);
  expect(moderationIssues('reject', 'other', ' ok ')).toHaveLength(1);
  expect(moderationIssues('reject', 'other', 'Concurrent')).toEqual([]);
});

test('every reason code has a French label; flags are readable', () => {
  for (const code of REVIEW_REASON_CODES) expect(REASON_LABELS[code]).toBeTruthy();
  expect(flagLabel('blocked_term:arnaque')).toContain('« arnaque »');
  expect(flagLabel('possible_personal_data')).toBe('e-mail ou téléphone possible');
  expect(flagLabel('unknown_flag')).toBe('unknown flag');
});

test('public rating state', () => {
  expect(publicRatingState(1, 3, true)).toEqual({ visible: false, text: expect.stringContaining('encore 2 avis') });
  expect(publicRatingState(3, 3, true).visible).toBe(true);
  expect(publicRatingState(10, 3, false).visible).toBe(false);
});
