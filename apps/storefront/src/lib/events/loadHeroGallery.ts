import type { EventGalleryCategory, EventGalleryPhoto } from '@lepefy/types';
import type { createPublicClient } from '@/lib/supabase/public';
import { MAX_HERO_IMAGES } from './selectHeroMedia';

/** Separate bounded candidates from the gallery section's display ordering. */
export async function loadHeroGallery(
  supabase: ReturnType<typeof createPublicClient>,
  tenantId: string,
  categories: readonly EventGalleryCategory[],
): Promise<EventGalleryPhoto[]> {
  const results = await Promise.all(categories.map((category) => {
    let query = supabase.from('event_gallery_photos')
      .select('*').eq('tenant_id', tenantId).eq('category', category);
    if (category === 'event' || category === 'ambiance' || category === 'general') query = query.is('event_id', null);
    return query.order('hero_eligible', { ascending: false })
      .order('hero_priority', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_HERO_IMAGES);
  }));
  // During the additive migration rollout, original gallery rows still render.
  if (results.some((result) => result.error)) {
    const legacy = await supabase.from('event_gallery_photos').select('*')
      .eq('tenant_id', tenantId).is('event_id', null)
      .order('sort_order', { ascending: true }).order('id', { ascending: true })
      .limit(MAX_HERO_IMAGES);
    return (legacy.data ?? []) as EventGalleryPhoto[];
  }
  return results.flatMap((result) => result.data ?? []) as EventGalleryPhoto[];
}
