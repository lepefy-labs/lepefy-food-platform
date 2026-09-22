import { expect, test } from '@playwright/test';
import { deterministicReviewFlags, normalizeReviewText, reviewerDisplayName } from '../../src/lib/reviews/reviewModeration';
import { reviewDispatchAuthorized } from '../../src/lib/reviews/reviewDispatchAuth';
import { summarizePublicReviewStats } from '../../src/lib/reviews/publicReviewSummary';
import { permissionForAdminApi } from '../../src/lib/auth/adminApiPermissions';
import { permissionForAdminPath } from '../../src/lib/auth/adminRoutePermissions';

test('blacklist matching is case/accent/punctuation insensitive and only flags content', () => {
  expect(normalizeReviewText('  TRÈS-mauvais!!!  ')).toBe('tres mauvais');
  expect(deterministicReviewFlags('Service TRÈS, mauvais.', ['très mauvais'])).toContain('blocked_term:tres mauvais');
  expect(deterministicReviewFlags('Contactez-moi a@example.com', [])).toContain('possible_personal_data');
});

test('reviewer display name does not expose email local-part', () => {
  expect(reviewerDisplayName(null, 'private.name@example.test')).toBe('Client vérifié');
  expect(reviewerDisplayName('Marie Dupont', 'x@example.test')).toBe('Marie D.');
});

test('reviews RBAC maps admin surfaces fail-closed by method', () => {
  expect(permissionForAdminPath('/admin/avis', 'shop')).toBe('reviews.view');
  expect(permissionForAdminApi('/api/admin/reviews/settings', 'GET')).toBe('reviews.view');
  expect(permissionForAdminApi('/api/admin/reviews/settings', 'PATCH')).toBe('reviews.manage');
  expect(permissionForAdminApi('/api/admin/reviews/abc', 'PATCH')).toBe('reviews.moderate');
  expect(permissionForAdminApi('/api/admin/reviews/abc', 'POST')).toBe('reviews.moderate');
});

test('review dispatcher bearer auth uses exact secret', () => {
  expect(reviewDispatchAuthorized('Bearer secret', 'secret')).toBe(true);
  expect(reviewDispatchAuthorized('Bearer wrong', 'secret')).toBe(false);
  expect(reviewDispatchAuthorized(null, 'secret')).toBe(false);
});

test('public reviews only show the average once the publication threshold is reached', () => {
  expect(summarizePublicReviewStats(null, 3)).toEqual({ publishedCount: 0, averageRating: null });
  expect(summarizePublicReviewStats({ published_count: 2, average_rating: '4.5' }, 3))
    .toEqual({ publishedCount: 2, averageRating: null });
  expect(summarizePublicReviewStats({ published_count: 3, average_rating: '4.5' }, 3))
    .toEqual({ publishedCount: 3, averageRating: 4.5 });
  expect(summarizePublicReviewStats({ published_count: 3, average_rating: 'not a rating' }, 3))
    .toEqual({ publishedCount: 3, averageRating: null });
});
