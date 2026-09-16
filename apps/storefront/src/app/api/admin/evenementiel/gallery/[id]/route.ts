import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { updateGallerySchema } from '@/lib/events/galleryEditorial';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const parsed = updateGallerySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données de la photo invalides.' }, { status: 400 });
  }
  const body = parsed.data;
  const supabase = createServiceClient();

  const { data: current, error: currentError } = await supabase.from('event_gallery_photos')
    .select('event_id, is_social_share').eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Photo introuvable.' }, { status: 404 });

  if (body.event_id) {
    const { data: event, error: eventError } = await supabase.from('events').select('id')
      .eq('id', body.event_id).eq('tenant_id', tenant.id).maybeSingle();
    if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
    if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 400 });
  }
  const eventId = body.event_id === undefined ? current.event_id : body.event_id;
  const socialShare = body.is_social_share ?? current.is_social_share;
  if (socialShare && !eventId) {
    return NextResponse.json({ error: 'Désactivez le partage social avant de dissocier l’événement.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('event_gallery_photos')
    .update(body)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Photo introuvable.' }, { status: 404 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { error } = await supabase
    .from('event_gallery_photos')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
