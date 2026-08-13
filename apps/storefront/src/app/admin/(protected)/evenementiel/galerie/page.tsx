import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import GalleryClient, { type GalleryEventOption } from './GalleryClient';
import type { EventGalleryPhoto } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export default async function AdminGalleryPage() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
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

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900 mb-1">Galerie</h1>
      <p className="text-sm text-gray-500 mb-6">
        Photos de vos événements passés, affichées sur la page publique <code>/evenementiel</code>.
      </p>

      <GalleryClient
        initialPhotos={(photos ?? []) as EventGalleryPhoto[]}
        events={(events ?? []) as GalleryEventOption[]}
      />
    </div>
  );
}
