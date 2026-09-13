import { expect, test } from '@playwright/test';
import {
  buildFeedbackInsert,
  campaignPatchSchema,
  feedbackUpdateSchema,
  publicFeedbackSchema,
} from '../../src/lib/feedback/contracts';

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
  expect(publicFeedbackSchema.safeParse({ ...valid, context: { ...valid.context, userAgent: 'secret' } }).success).toBe(false);
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
