import { expect, test } from '@playwright/test';
import {
  buildFeedbackInsert,
  campaignPatchSchema,
  feedbackUpdateSchema,
  publicFeedbackSchema,
  testerImportSchema,
} from '../../src/lib/feedback/contracts';
import { createOpaqueToken, hashOpaqueToken, isOpaqueToken } from '../../src/lib/feedback/testerInviteTokens';

const valid = {
  message: 'Une idée utile',
  reaction: 'good' as const,
  category: 'idea' as const,
  contactAllowed: false,
  contactEmail: null,
  website: '',
  dwellMs: 1200,
  context: { pathname: '/feedback', language: 'fr-FR', viewportWidth: 390, viewportHeight: 844, standalone: true },
};

test('accepts a minimal useful public feedback payload', () => {
  expect(publicFeedbackSchema.safeParse(valid).success).toBe(true);
});

test('rejects blank messages, unknown fields and invalid enums', () => {
  expect(publicFeedbackSchema.safeParse({ ...valid, message: '   ' }).success).toBe(false);
  expect(publicFeedbackSchema.safeParse({ ...valid, reaction: 'angry' }).success).toBe(false);
  expect(publicFeedbackSchema.safeParse({ ...valid, tenantId: crypto.randomUUID() }).success).toBe(false);
  expect(publicFeedbackSchema.safeParse({ ...valid, testerInviteId: crypto.randomUUID() }).success).toBe(false);
  expect(publicFeedbackSchema.safeParse({ ...valid, verifiedTester: true }).success).toBe(false);
  expect(publicFeedbackSchema.safeParse({ ...valid, context: { ...valid.context, userAgent: 'secret' } }).success).toBe(false);
});

test('accepts only official HTTPS Google Play campaign URLs', () => {
  expect(campaignPatchSchema.safeParse({ googlePlayTestUrl: null }).success).toBe(true);
  expect(campaignPatchSchema.safeParse({ googlePlayTestUrl: 'https://play.google.com/store/apps/details?id=example' }).success).toBe(true);
  expect(campaignPatchSchema.safeParse({ googlePlayTestUrl: 'http://play.google.com/test' }).success).toBe(false);
  expect(campaignPatchSchema.safeParse({ googlePlayTestUrl: 'https://play.google.com.evil.test/test' }).success).toBe(false);
});

test('normalizes and deduplicates tester emails', () => {
  const parsed = testerImportSchema.parse({ emails: [' Tester@Example.com ', 'tester@example.com', 'other@example.com'] });
  expect(parsed.emails).toEqual(['tester@example.com', 'other@example.com']);
});

test('creates high-entropy opaque credentials and deterministic hashes', () => {
  const token = createOpaqueToken();
  expect(isOpaqueToken(token)).toBe(true);
  expect(token).not.toContain('=');
  expect(hashOpaqueToken(token)).toMatch(/^[0-9a-f]{64}$/);
  expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
});

test('requires an email only when contact consent is granted', () => {
  expect(publicFeedbackSchema.safeParse({ ...valid, contactAllowed: true, contactEmail: null }).success).toBe(false);
  expect(publicFeedbackSchema.safeParse({ ...valid, contactAllowed: true, contactEmail: 'tester@example.com' }).success).toBe(true);
});

test('drops contact data without consent and keeps only the safe context', () => {
  const parsed = publicFeedbackSchema.parse({ ...valid, contactEmail: 'Private@Example.com' });
  const insert = buildFeedbackInsert(parsed, 'beta-3');
  expect(insert.contact_email).toBeNull();
  expect(insert.context).toEqual({
    pathname: '/feedback',
    language: 'fr-FR',
    viewport_width: 390,
    viewport_height: 844,
    standalone: true,
    campaign_version: 'beta-3',
  });
});

test('admin mutations reject unsafe or immutable fields', () => {
  expect(feedbackUpdateSchema.safeParse({ status: 'resolved', contact_email: 'x@example.com' }).success).toBe(false);
  expect(campaignPatchSchema.safeParse({ tenantId: crypto.randomUUID() }).success).toBe(false);
  expect(campaignPatchSchema.safeParse({ active: false }).success).toBe(true);
});
