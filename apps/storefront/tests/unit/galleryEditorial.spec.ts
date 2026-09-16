import { expect, test } from '@playwright/test';
import { createGallerySchema, updateGallerySchema, heroPriorityOption } from '../../src/lib/events/galleryEditorial';

test('creation accepts optional event association and every editorial category', () => {
  for (const category of ['event', 'traiteur', 'location_materiel', 'ambiance', 'general']) {
    expect(createGallerySchema.safeParse({ image_url: 'https://images.example/photo', category, event_id: null }).success).toBe(true);
  }
  expect(createGallerySchema.safeParse({ image_url: 'https://images.example/photo' }).success).toBe(true);
});

test('priority must be an integer between zero and 100 and flags must be booleans', () => {
  for (const hero_priority of [-1, 101, 0.5, '50', null]) expect(updateGallerySchema.safeParse({ hero_priority }).success).toBe(false);
  for (const hero_priority of [0, 25, 50, 75, 100]) expect(updateGallerySchema.safeParse({ hero_priority }).success).toBe(true);
  expect(updateGallerySchema.safeParse({ hero_eligible: 'true' }).success).toBe(false);
  expect(updateGallerySchema.safeParse({ is_social_share: 1 }).success).toBe(false);
});

test('social and hero patches do not implicitly change each other', () => {
  expect(updateGallerySchema.parse({ is_social_share: true })).toEqual({ is_social_share: true });
  expect(updateGallerySchema.parse({ hero_eligible: true })).toEqual({ hero_eligible: true });
});

test('only explicitly supported fields can be patched', () => {
  for (const value of [{}, null, { category: 'unknown' }, { event_id: 'not-a-uuid' }, { tenant_id: 'foreign' }, { image_url: 'https://images.example/new' }, { sort_order: 3 }]) {
    expect(updateGallerySchema.safeParse(value).success).toBe(false);
  }
  expect(updateGallerySchema.parse({ caption: '  Nouvelle légende  ', event_id: null })).toEqual({ caption: 'Nouvelle légende', event_id: null });
});

test('human-friendly priority bands preserve arbitrary persisted priorities until explicitly edited', () => {
  expect([0, 29, 30, 69, 70, 100].map(heroPriorityOption)).toEqual([25, 25, 50, 50, 75, 75]);
});
