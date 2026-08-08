import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { EventStatus } from '@lepefy/types';

const VALID_STATUSES: EventStatus[] = ['draft', 'published', 'closed', 'cancelled'];

const EDITABLE_FIELDS = [
  'title', 'slug', 'description', 'date_start', 'location',
  'capacity_total', 'status', 'banner_image_url',
] as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: event } = await supabase
    .from('events')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  const { data: ticketTypes } = await supabase
    .from('event_ticket_types')
    .select('*')
    .eq('event_id', event.id)
    .order('sort_order', { ascending: true });

  const { data: reservations } = await supabase
    .from('event_reservations')
    .select('*')
    .eq('event_id', event.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ event, ticketTypes: ticketTypes ?? [], reservations: reservations ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === 'status' && !VALID_STATUSES.includes(body.status as EventStatus)) continue;
    if (field === 'capacity_total') {
      const n = Number(body.capacity_total);
      if (!Number.isInteger(n) || n < 0) continue;
      patch.capacity_total = n;
      continue;
    }
    patch[field] = body[field];
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Si la capacité totale change, on ajuste le restant en conservant le
  // nombre de places déjà réservées (capacity_total - déjà réservé).
  if (patch.capacity_total !== undefined) {
    const { data: current } = await supabase
      .from('events')
      .select('capacity_total, capacity_remaining')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();

    if (current) {
      const alreadyReserved = current.capacity_total - current.capacity_remaining;
      patch.capacity_remaining = Math.max(0, (patch.capacity_total as number) - alreadyReserved);
    }
  }

  const { data, error } = await supabase
    .from('events')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Un événement avec ce slug existe déjà.' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { count } = await supabase
    .from('event_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', params.id);

  if (count && count > 0) {
    return NextResponse.json(
      { error: 'Impossible de supprimer un événement ayant des réservations — annulez-le plutôt.' },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from('events')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
