import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const label = String(body.label ?? '').trim();
  const price = Number(body.price);

  if (!label || !Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: 'Libellé et prix valides requis.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('id, slug')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  const { data: lastTicket } = await supabase
    .from('event_ticket_types')
    .select('sort_order')
    .eq('event_id', event.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (lastTicket?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('event_ticket_types')
    .insert({
      tenant_id:   tenant.id,
      event_id:    event.id,
      label,
      description: body.description ? String(body.description).trim() : null,
      price,
      sort_order:  nextSortOrder,
      active:      body.active === undefined ? true : Boolean(body.active),
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidatePath(`/evenementiel/evenements/${event.slug}`);
  revalidatePath('/evenementiel');

  return NextResponse.json(data, { status: 201 });
}
