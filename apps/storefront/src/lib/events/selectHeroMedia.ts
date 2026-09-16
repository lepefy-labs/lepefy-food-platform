import type { EventGalleryCategory, EventGalleryPhoto, EventRow, ServiceOffering } from '@lepefy/types';

export const IMMINENT_EVENT_DAYS = 14;
export const MAX_HERO_IMAGES = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

export type HeroContext = 'imminent_event' | 'upcoming_event' | 'no_events';
type HeroEvent = Pick<EventRow, 'id' | 'date_start' | 'status' | 'banner_image_url'>;
type HeroPhoto = Pick<EventGalleryPhoto, 'id' | 'event_id' | 'image_url'> &
  Partial<Pick<EventGalleryPhoto, 'category' | 'hero_eligible' | 'hero_priority' | 'sort_order' | 'created_at'>>;
type HeroService = Pick<ServiceOffering, 'id' | 'type' | 'cta_type' | 'active' | 'cover_image_url' | 'sort_order'>;

export function getHeroContext<T extends HeroEvent>(events: readonly T[], now = new Date()) {
  const futureEvents = events
    .filter((event) => event.status === 'published' && new Date(event.date_start).getTime() >= now.getTime())
    .slice()
    .sort((a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime() || a.id.localeCompare(b.id));
  const nextEvent = futureEvents[0] ?? null;
  const imminentEvent = nextEvent && new Date(nextEvent.date_start).getTime() - now.getTime() <= IMMINENT_EVENT_DAYS * DAY_MS
    ? nextEvent : null;
  const context: HeroContext = imminentEvent ? 'imminent_event' : nextEvent ? 'upcoming_event' : 'no_events';
  return { context, nextEvent, imminentEvent };
}

function categoryOf(photo: HeroPhoto): EventGalleryCategory {
  return photo.category ?? (photo.event_id ? 'event' : 'general');
}

function comparePhotos(a: HeroPhoto, b: HeroPhoto) {
  return Number(Boolean(b.hero_eligible)) - Number(Boolean(a.hero_eligible))
    || (b.hero_priority ?? 50) - (a.hero_priority ?? 50)
    || (a.sort_order ?? 0) - (b.sort_order ?? 0)
    || (a.created_at ?? '').localeCompare(b.created_at ?? '')
    || a.id.localeCompare(b.id);
}

/** Catering detail pages rotate only their editorial category; the cover is an empty-pool fallback. */
export function selectCateringHeroMedia(photos: readonly HeroPhoto[], coverImageUrl: string | null): string[] {
  const urls = photos.filter((photo) => categoryOf(photo) === 'traiteur').slice().sort(comparePhotos)
    .map((photo) => photo.image_url.trim()).filter(Boolean);
  const images = Array.from(new Set(urls)).slice(0, MAX_HERO_IMAGES);
  const cover = coverImageUrl?.trim();
  return images.length ? images : cover ? [cover] : [];
}

/** Stable editorial rotation. Inputs are tenant-scoped by the caller; never mutated. */
export function selectHeroMedia({
  events,
  photos,
  services,
  now = new Date(),
}: {
  events: readonly HeroEvent[];
  photos: readonly HeroPhoto[];
  services: readonly HeroService[];
  now?: Date;
}): string[] {
  const { context, nextEvent, imminentEvent } = getHeroContext(events, now);
  const ranked = photos.slice().sort(comparePhotos);
  const activeServices = services.filter((service) => service.active).slice()
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const catering = activeServices.filter((service) => service.type === 'traiteur' || service.cta_type === 'devis');
  const rental = activeServices.filter((service) => service.type === 'location_materiel' || service.cta_type === 'reservation');
  const result: string[] = [];
  const seen = new Set<string>();

  function add(urls: readonly (string | null)[], count = MAX_HERO_IMAGES) {
    let added = 0;
    for (const value of urls) {
      const url = value?.trim();
      if (!url || seen.has(url)) continue;
      if (result.length >= MAX_HERO_IMAGES || added >= count) break;
      seen.add(url);
      result.push(url);
      added += 1;
    }
  }
  function categoryUrls(category: EventGalleryCategory, eligibleOnly = false) {
    return ranked.filter((photo) => categoryOf(photo) === category && (!eligibleOnly || photo.hero_eligible))
      .map((photo) => photo.image_url);
  }
  const neutral = ranked.filter((photo) => !photo.event_id && (categoryOf(photo) === 'ambiance' || categoryOf(photo) === 'general'));

  if (context === 'imminent_event' && imminentEvent) {
    const linked = ranked.filter((photo) => photo.event_id === imminentEvent.id);
    add(linked.map((photo) => photo.image_url), 5);
    add([imminentEvent.banner_image_url]);
    // A single ambiance image is appropriate only when the event already dominates.
    if (result.length >= 4) add(neutral.filter((photo) => photo.hero_eligible && categoryOf(photo) === 'ambiance').map((photo) => photo.image_url), 1);
    // Never mix service or another event's imagery with imminent-event metadata.
    if (!result.length) add(neutral.map((photo) => photo.image_url), 1);
    return result;
  }

  if (context === 'upcoming_event' && nextEvent) {
    const eventMedia = ranked.filter((photo) => photo.event_id === nextEvent.id || (!photo.event_id && categoryOf(photo) === 'event'));
    const eventUrls = eventMedia.map((photo) => photo.image_url);
    add(eventUrls, 3);
    add([nextEvent.banner_image_url], Math.max(0, 3 - result.length));
    if (catering.length) add([...categoryUrls('traiteur'), ...catering.map((service) => service.cover_image_url)], 1);
    add(neutral.filter((photo) => categoryOf(photo) === 'ambiance').map((photo) => photo.image_url), 1);
    add(eventUrls);
    add([nextEvent.banner_image_url]);
    if (catering.length) add([...categoryUrls('traiteur'), ...catering.map((service) => service.cover_image_url)]);
    add(neutral.map((photo) => photo.image_url));
    add(activeServices.map((service) => service.cover_image_url));
  } else {
    // Disabled/unavailable services must not be promoted by the hero.
    const cateringUrls = catering.length ? [...categoryUrls('traiteur'), ...catering.map((service) => service.cover_image_url)] : [];
    const rentalUrls = rental.length ? [...categoryUrls('location_materiel'), ...rental.map((service) => service.cover_image_url)] : [];
    const ambianceUrls = neutral.filter((photo) => categoryOf(photo) === 'ambiance').map((photo) => photo.image_url);
    add(cateringUrls, 3);
    add(rentalUrls, 2);
    add(ambianceUrls, 1);
    add(cateringUrls);
    add(rentalUrls);
    add(ambianceUrls);
    add(neutral.filter((photo) => categoryOf(photo) === 'general').map((photo) => photo.image_url));
    add(activeServices.map((service) => service.cover_image_url));
  }
  return result;
}
