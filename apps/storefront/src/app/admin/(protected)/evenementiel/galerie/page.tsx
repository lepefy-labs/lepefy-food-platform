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
    is_social_share: Boolean((photo as { is_social_share?: boolean }).is_social_share),
  })) as EventGalleryPhoto[];

  return (
    <div className="max-w-5xl">
      <h1 className="mb-1 text-xl font-semibold text-gray-900">Galerie & kit social</h1>
      <p className="mb-6 max-w-2xl text-sm text-gray-500">
        Gérez les photos de vos événements et choisissez celles que les visiteurs peuvent transformer en story 9:16 pour WhatsApp, Instagram, TikTok et les autres apps installées.
      </p>

      <GalleryClient
        initialPhotos={normalizedPhotos}
        events={(events ?? []) as GalleryEventOption[]}
      />
    </div>
  );
}
