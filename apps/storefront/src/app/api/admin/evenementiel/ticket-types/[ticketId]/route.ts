import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

function revalidateEventPaths(eventSlug: string | undefined) {
  if (!eventSlug) return;
  revalidatePath(`/evenementiel/evenements/${eventSlug}`);
  revalidatePath('/evenementiel');
}

const EDITABLE_FIELDS = ['label', 'description', 'price', 'sort_order', 'active', 'badge'] as const;

export async function PATCH(req: NextRequest, { params }: { params: { ticketId: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;

    if (field === 'label') {
      if (typeof body.label !== 'string' || !body.label.trim()) {
        return NextResponse.json({ error: 'Le libellé est requis.' }, { status: 400 });
      }
      patch.label = body.label.trim();
      continue;
    }

    if (field === 'price') {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: 'Le prix doit être un nombre positif ou nul.' }, { status: 400 });
      }
      patch.price = price;
      continue;
    }

    if (field === 'description' || field === 'badge') {
      const value = body[field];
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: `${field} doit être une chaîne ou null.` }, { status: 400 });
      }
      patch[field] = typeof value === 'string' ? value.trim() || null : null;
      continue;
    }

    if (field === 'active') {
      if (typeof body.active !== 'boolean') {
        return NextResponse.json({ error: 'active doit être un booléen.' }, { status: 400 });
      }
      patch.active = body.active;
      continue;
    }

    if (field === 'sort_order') {
      const sortOrder = Number(body.sort_order);
      if (!Number.isInteger(sortOrder)) {
        return NextResponse.json({ error: 'sort_order doit être un entier.' }, { status: 400 });
      }
      patch.sort_order = sortOrder;
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('event_ticket_types')
    .update(patch)
    .eq('id', params.ticketId)
    .eq('tenant_id', tenant.id)
    .select('*, events(slug)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const patchedEventSlug = (data.events as unknown as { slug?: string } | null)?.slug;
  revalidateEventPaths(patchedEventSlug);
  delete data.events;

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { ticketId: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: ticketRow } = await supabase
    .from('event_ticket_types')
    .select('events(slug)')
    .eq('id', params.ticketId)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  const eventSlug = (ticketRow?.events as unknown as { slug?: string } | null)?.slug;

  const { count } = await supabase
    .from('event_reservation_items')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_type_id', params.ticketId);

  if (count && count > 0) {
    const { data, error } = await supabase
      .from('event_ticket_types')
      .update({ active: false })
      .eq('id', params.ticketId)
      .eq('tenant_id', tenant.id)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    revalidateEventPaths(eventSlug);
    return NextResponse.json({ success: true, deactivated: true, ticketType: data });
  }

  const { error } = await supabase
    .from('event_ticket_types')
    .delete()
    .eq('id', params.ticketId)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  revalidateEventPaths(eventSlug);
  return NextResponse.json({ success: true, deactivated: false });
}
