import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { EventStatus } from '@lepefy/types';

const VALID_STATUSES: EventStatus[] = ['draft', 'published', 'closed', 'cancelled'];

export async function GET() {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('date_start', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;

  const title = String(body.title ?? '').trim();
  const slugValue = String(body.slug ?? '').trim();
  const dateStart = String(body.date_start ?? '');
  const capacityTotal = Number(body.capacity_total);

  if (!title || !slugValue || !dateStart || !Number.isInteger(capacityTotal) || capacityTotal < 0) {
    return NextResponse.json({ error: 'Titre, slug, date et capacité valides requis.' }, { status: 400 });
  }

  const status: EventStatus = VALID_STATUSES.includes(body.status as EventStatus)
    ? body.status as EventStatus
    : 'draft';

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('events')
    .insert({
      tenant_id:           tenant.id,
      slug:                slugValue,
      title,
      description:         body.description ? String(body.description).trim() : null,
      date_start:          dateStart,
      location:            body.location ? String(body.location).trim() : null,
      capacity_total:      capacityTotal,
      capacity_remaining:  capacityTotal,
      status,
      banner_image_url:    body.banner_image_url ? String(body.banner_image_url) : null,
    })
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Un événement avec ce slug existe déjà.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
