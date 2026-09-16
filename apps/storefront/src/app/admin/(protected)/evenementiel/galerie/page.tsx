import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import GalleryClient, { type GalleryEventOption } from './GalleryClient';
import type { EventGalleryPhoto } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminGalleryPage() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();
  const [{ data: photos }, { data: events }] = await Promise.all([
    supabase
      .from('event_gallery_photos')
      .select('*')
      .eq('tenant_id', tenant.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('events')
      .select('id, title, date_start')
      .eq('tenant_id', tenant.id)
      .order('date_start', { ascending: false }),
  ]);

  const normalizedPhotos = (photos ?? []).map((photo) => ({
    ...photo,
    is_social_share: Boolean(photo.is_social_share),
    category: photo.category ?? (photo.event_id ? 'event' : 'general'),
    hero_eligible: Boolean(photo.hero_eligible),
    hero_priority: photo.hero_priority ?? 50,
  })) as EventGalleryPhoto[];

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Galerie événementielle</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Classez vos photos d’événements, de traiteur et de location, choisissez celles à mettre en avant dans le hero et gérez le kit social des événements.
      </p>

      <GalleryClient
        initialPhotos={normalizedPhotos}
        events={(events ?? []) as GalleryEventOption[]}
      />
    </div>
  );
}
