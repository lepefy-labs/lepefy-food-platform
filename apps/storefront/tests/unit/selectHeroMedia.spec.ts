import { expect, test } from '@playwright/test';
import type { EventGalleryPhoto, EventRow, ServiceOffering } from '@lepefy/types';
import { getHeroContext, MAX_HERO_IMAGES, selectCateringHeroMedia, selectHeroMedia } from '../../src/lib/events/selectHeroMedia';

const now = new Date('2026-09-16T12:00:00Z');
type HeroPhoto = Parameters<typeof selectHeroMedia>[0]['photos'][number];
type HeroEvent = Parameters<typeof selectHeroMedia>[0]['events'][number];
type HeroService = Parameters<typeof selectHeroMedia>[0]['services'][number];

function event(days: number, overrides: Partial<HeroEvent> = {}): HeroEvent {
  return { id: 'next', status: 'published', date_start: new Date(now.getTime() + days * 86400000).toISOString(), banner_image_url: null, ...overrides };
}
function photo(id: string, category: EventGalleryPhoto['category'] = 'general', overrides: Partial<HeroPhoto> = {}): HeroPhoto {
  return { id, image_url: 'https://images.example/' + id, event_id: null, category, hero_eligible: true, hero_priority: 50, sort_order: 0, ...overrides };
}
function service(type: ServiceOffering['type'], overrides: Partial<HeroService> = {}): HeroService {
  return { id: type, type, cta_type: type === 'traiteur' ? 'devis' : 'reservation', active: true, cover_image_url: null, sort_order: 0, ...overrides };
}
function select(events: HeroEvent[], photos: HeroPhoto[], services: HeroService[] = []) {
  return selectHeroMedia({ events, photos, services, now });
}

test('A: imminent-event photos dominate; eligibility and priority rank linked images first', () => {
  const linked = [
    photo('low', 'event', { event_id: 'next', hero_priority: 25 }),
    photo('high', 'event', { event_id: 'next', hero_priority: 75 }),
    photo('normal', 'event', { event_id: 'next' }),
    photo('legacy', 'event', { event_id: 'next', hero_eligible: false, hero_priority: 100 }),
  ];
  const images = select([event(5)], [...linked, photo('food', 'traiteur'), photo('rental', 'location_materiel'), photo('other', 'event', { event_id: 'other' }), photo('atmosphere', 'ambiance')], [service('traiteur'), service('location_materiel')]);
  expect(images).toEqual(['high', 'normal', 'low', 'legacy', 'atmosphere'].map((id) => 'https://images.example/' + id));
});

test('B: imminent event with no photos uses its banner, without service images', () => {
  expect(select([event(5, { banner_image_url: 'https://images.example/banner' })], [photo('food', 'traiteur'), photo('atmosphere', 'ambiance')], [service('traiteur')]))
    .toEqual(['https://images.example/banner']);
});

test('C: later future event mixes event, catering and ambiance in a stable order', () => {
  const images = select([event(30)], [
    ...[1, 2, 3, 4, 5].map((i) => photo('event-' + i, 'event', { event_id: 'next', sort_order: i })),
    photo('food', 'traiteur'), photo('atmosphere', 'ambiance'),
  ], [service('traiteur')]);
  expect(images).toEqual(['event-1', 'event-2', 'event-3', 'food', 'atmosphere', 'event-4'].map((id) => 'https://images.example/' + id));
  expect(getHeroContext([event(30)], now).context).toBe('upcoming_event');
});

test('D: no future events prefers catering, rental, then ambiance', () => {
  expect(select([], [photo('atmosphere', 'ambiance'), photo('rental', 'location_materiel'), photo('food', 'traiteur')], [service('traiteur'), service('location_materiel')]))
    .toEqual(['food', 'rental', 'atmosphere'].map((id) => 'https://images.example/' + id));
});

test('no-event rotation reserves room for rental and ambiance when catering has many photos', () => {
  const images = select([], [
    ...Array.from({ length: 10 }, (_, i) => photo('food-' + i, 'traiteur', { sort_order: i })),
    photo('rental-1', 'location_materiel'), photo('rental-2', 'location_materiel'),
    photo('atmosphere', 'ambiance'),
  ], [service('traiteur'), service('location_materiel')]);
  expect(images).toHaveLength(MAX_HERO_IMAGES);
  expect(images.slice(3)).toEqual(['rental-1', 'rental-2', 'atmosphere'].map((id) => 'https://images.example/' + id));
});

test('E: existing non-eligible media remains a safe fallback', () => {
  expect(select([], [photo('food', 'traiteur', { hero_eligible: false }), photo('rental', 'location_materiel', { hero_eligible: false }), photo('atmosphere', 'ambiance', { hero_eligible: false })], [service('traiteur'), service('location_materiel')]))
    .toEqual(['food', 'rental', 'atmosphere'].map((id) => 'https://images.example/' + id));
});

test('F: duplicate and blank URLs never consume rotation slots', () => {
  const shared = 'https://images.example/shared';
  const images = select([], [photo('one', 'traiteur', { image_url: shared }), photo('two', 'traiteur', { image_url: ' ' + shared + ' ' }), photo('blank', 'traiteur', { image_url: ' ' }), photo('rental', 'location_materiel')], [service('traiteur', { cover_image_url: shared }), service('location_materiel')]);
  expect(images).toEqual([shared, 'https://images.example/rental']);
});

test('G: missing editorial fields and empty pools keep color fallback possible', () => {
  expect(select([], [])).toEqual([]);
  expect(select([], [{ id: 'old', event_id: null, image_url: 'https://images.example/old' }])).toEqual(['https://images.example/old']);
  expect(select([event(5)], [{ id: 'old-event', event_id: 'next', image_url: 'https://images.example/old-event' }])).toEqual(['https://images.example/old-event']);
});

test('inactive or absent services do not contribute imagery', () => {
  expect(select([], [photo('food', 'traiteur'), photo('rental', 'location_materiel'), photo('general')], [service('traiteur', { active: false }), service('location_materiel', { active: false })]))
    .toEqual(['https://images.example/general']);
});

test('service cover images remain canonical fallback sources', () => {
  expect(select([], [], [service('traiteur', { cover_image_url: 'https://images.example/food-cover' }), service('location_materiel', { cover_image_url: 'https://images.example/rental-cover' })]))
    .toEqual(['https://images.example/food-cover', 'https://images.example/rental-cover']);
});

test('imminent event without any relevant media never falls back to a service or another event', () => {
  expect(select([event(5)], [photo('food', 'traiteur'), photo('other', 'event', { event_id: 'other' })], [service('traiteur', { cover_image_url: 'https://images.example/food-cover' })])).toEqual([]);
});

test('one event image is not diluted by unrelated ambiance', () => {
  expect(select([event(5)], [photo('event', 'event', { event_id: 'next' }), photo('atmosphere', 'ambiance')])).toEqual(['https://images.example/event']);
});

test('published future filtering and the 14-day boundary determine context', () => {
  expect(getHeroContext([event(-1), event(1, { status: 'draft' }), event(2, { status: 'cancelled' }), event(3, { status: 'closed' })], now).context).toBe('no_events');
  expect(getHeroContext([event(14)], now).context).toBe('imminent_event');
  expect(getHeroContext([event(14 + 1 / 86400000)], now).context).toBe('upcoming_event');
  expect(getHeroContext([event(0)], now).context).toBe('imminent_event');
  expect(getHeroContext([event(1, { date_start: 'invalid' })], now).context).toBe('no_events');
});

test('unsorted events select the nearest valid event without mutating input', () => {
  const events = [event(30, { id: 'later' }), event(5)];
  const original = events.slice();
  expect(getHeroContext(events, now).nextEvent?.id).toBe('next');
  expect(select(events, [photo('next-photo', 'event', { event_id: 'next' }), photo('later-photo', 'event', { event_id: 'later' })])).toEqual(['https://images.example/next-photo']);
  expect(events).toEqual(original);
});

test('ranking uses eligibility, priority, sort order, created date and id, independently of input order', () => {
  const photos = [
    photo('legacy', 'traiteur', { hero_eligible: false, hero_priority: 100 }),
    photo('b', 'traiteur', { created_at: '2026-01-01', sort_order: 2 }),
    photo('a', 'traiteur', { created_at: '2026-01-01', sort_order: 2 }),
    photo('later', 'traiteur', { created_at: '2026-02-01', sort_order: 2 }),
    photo('first', 'traiteur', { sort_order: 1 }),
    photo('priority', 'traiteur', { hero_priority: 75, sort_order: 100 }),
  ];
  const original = photos.slice();
  const expected = ['priority', 'first', 'a', 'b', 'later', 'legacy'].map((id) => 'https://images.example/' + id);
  expect(select([], photos, [service('traiteur')])).toEqual(expected);
  expect(select([], photos.slice().reverse(), [service('traiteur')])).toEqual(expected);
  expect(photos).toEqual(original);
});

test('past-event ambiance is excluded from event metadata and no-event neutral fallbacks', () => {
  expect(select([], [photo('past', 'ambiance', { event_id: 'past' }), photo('neutral', 'ambiance')])).toEqual(['https://images.example/neutral']);
});

test('generic event imagery is usable in the broad upcoming-event context', () => {
  expect(select([event(30)], [photo('generic-event', 'event')])).toEqual(['https://images.example/generic-event']);
});

// These type-level assignments ensure shared persisted contracts keep their existing fields.
type PersistedPhoto = Pick<EventGalleryPhoto, 'category' | 'hero_eligible' | 'hero_priority' | 'is_social_share'>;
type PersistedEvent = Pick<EventRow, 'status'>;
test('shared editorial and event contracts remain compatible', () => {
  const media: PersistedPhoto = { category: 'event', hero_eligible: false, hero_priority: 50, is_social_share: true };
  const published: PersistedEvent = { status: 'published' };
  expect(media.hero_eligible).toBe(false);
  expect(published.status).toBe('published');
});

test('catering detail excludes ambiance, rental, event and general photos even when hero-approved', () => {
  expect(selectCateringHeroMedia([
    photo('ambiance', 'ambiance'), photo('rental', 'location_materiel'),
    photo('event', 'event'), photo('general'), photo('catering', 'traiteur'),
  ], 'https://images.example/cover')).toEqual(['https://images.example/catering']);
});

test('catering detail ranks eligibility and priority deterministically without changing inputs', () => {
  const photos = [
    photo('legacy', 'traiteur', { hero_eligible: false, hero_priority: 100 }),
    photo('normal', 'traiteur'), photo('high', 'traiteur', { hero_priority: 75 }),
  ];
  const original = photos.slice();
  const expected = ['high', 'normal', 'legacy'].map((id) => 'https://images.example/' + id);
  expect(selectCateringHeroMedia(photos, null)).toEqual(expected);
  expect(selectCateringHeroMedia(photos.slice().reverse(), null)).toEqual(expected);
  expect(photos).toEqual(original);
});

test('catering detail deduplicates trimmed URLs, skips blanks and limits rotation to six', () => {
  const photos = [
    photo('blank', 'traiteur', { image_url: ' ' }),
    photo('one', 'traiteur', { image_url: ' https://images.example/shared ' }),
    photo('two', 'traiteur', { image_url: 'https://images.example/shared' }),
    ...Array.from({ length: 8 }, (_, i) => photo('food-' + i, 'traiteur', { sort_order: i + 1 })),
  ];
  const images = selectCateringHeroMedia(photos, null);
  expect(images).toHaveLength(MAX_HERO_IMAGES);
  expect(images[0]).toBe('https://images.example/shared');
  expect(new Set(images).size).toBe(MAX_HERO_IMAGES);
});

test('catering detail uses its cover only when no usable catering photo exists', () => {
  expect(selectCateringHeroMedia([photo('other', 'ambiance')], ' https://images.example/cover '))
    .toEqual(['https://images.example/cover']);
  expect(selectCateringHeroMedia([photo('catering', 'traiteur')], 'https://images.example/cover'))
    .toEqual(['https://images.example/catering']);
});

test('catering detail leaves the color fallback possible for empty and legacy-only pools', () => {
  expect(selectCateringHeroMedia([], null)).toEqual([]);
  expect(selectCateringHeroMedia([{ id: 'old', event_id: null, image_url: 'https://images.example/old' }], ' '))
    .toEqual([]);
});
