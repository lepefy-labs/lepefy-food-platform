import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import type { EventStatus } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const VALID_STATUSES: EventStatus[] = ['draft', 'published', 'closed', 'cancelled'];
const EDITABLE_FIELDS = [
  'title', 'slug', 'description', 'date_start', 'booking_closes_at', 'location',
  'status', 'banner_image_url', 'on_site_price_list_image_url', 'subtitle', 'highlights',
  'show_remaining_places', 'checkin_opens_at', 'checkin_closes_at',
] as const;
const MAX_HIGHLIGHTS = 3;

interface HighlightInput { icon?: unknown; title?: unknown; text?: unknown; }

function sanitizeHighlights(value: unknown): { data: unknown; error: string | null } {
  if (value === null) return { data: null, error: null };
  if (!Array.isArray(value)) return { data: null, error: 'highlights doit être un tableau ou null.' };
  const cleaned = (value as HighlightInput[])
    .slice(0, MAX_HIGHLIGHTS)
    .map((h) => ({
      icon: typeof h.icon === 'string' ? h.icon : 'sparkles',
      title: typeof h.title === 'string' ? h.title.trim() : '',
      text: typeof h.text === 'string' ? h.text.trim() : '',
    }))
    .filter((h) => h.title || h.text);
  return { data: cleaned.length > 0 ? cleaned : null, error: null };
}

function normalizeOptionalDate(value: unknown): { value: string | null; valid: boolean } {
  if (value === null || value === '') return { value: null, valid: true };
  if (typeof value !== 'string') return { value: null, valid: false };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { value: null, valid: false };
  return { value: date.toISOString(), valid: true };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data: event } = await supabase.from('events').select('*').eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (!event) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

  const { data: ticketTypes } = await supabase.from('event_ticket_types').select('*').eq('event_id', event.id).order('sort_order', { ascending: true });
  const { data: reservations } = await supabase.from('event_reservations').select('*').eq('event_id', event.id).order('created_at', { ascending: false });
  return NextResponse.json({ event, ticketTypes: ticketTypes ?? [], reservations: reservations ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    if (field === 'status' && !VALID_STATUSES.includes(body.status as EventStatus)) continue;
    if (field === 'highlights') {
      const { data, error } = sanitizeHighlights(body.highlights);
      if (error) return NextResponse.json({ error }, { status: 400 });
      patch.highlights = data;
      continue;
    }
    if (field === 'show_remaining_places') {
      if (typeof body[field] !== 'boolean') {
        return NextResponse.json({ error: 'show_remaining_places doit être un booléen.' }, { status: 400 });
      }
      patch[field] = body[field];
      continue;
    }
    if (field === 'on_site_price_list_image_url') {
      const value = body[field];
      if (value !== null && typeof value !== 'string') {
        return NextResponse.json({ error: 'on_site_price_list_image_url doit être une URL ou null.' }, { status: 400 });
      }
      patch[field] = typeof value === 'string' ? value.trim() || null : null;
      continue;
    }
    if (field === 'booking_closes_at' || field === 'checkin_opens_at' || field === 'checkin_closes_at') {
      const normalized = normalizeOptionalDate(body[field]);
      if (!normalized.valid) return NextResponse.json({ error: `${field} doit être une date valide ou null.` }, { status: 400 });
      patch[field] = normalized.value;
      continue;
    }
    patch[field] = body[field];
  }

  if (body.capacity_total !== undefined) {
    return NextResponse.json({ error: 'La capacité se modifie depuis l’action dédiée « Gérer la capacité ».' }, { status: 400 });
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide à mettre à jour.' }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (patch.status === 'published') {
    const { count } = await supabase.from('event_ticket_types').select('id', { count: 'exact', head: true }).eq('event_id', params.id).eq('active', true);
    if (!count) return NextResponse.json({ error: 'Impossible de publier un événement sans au moins une formule active.' }, { status: 400 });
  }

  if (patch.booking_closes_at !== undefined || patch.date_start !== undefined) {
    const { data: current } = await supabase
      .from('events')
      .select('date_start, booking_closes_at')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });

    const dateStartValue = patch.date_start !== undefined ? patch.date_start : current.date_start;
    const dateStart = new Date(String(dateStartValue));
    if (Number.isNaN(dateStart.getTime())) {
      return NextResponse.json({ error: 'date_start doit être une date valide.' }, { status: 400 });
    }

    const bookingClosesAt = patch.booking_closes_at !== undefined ? patch.booking_closes_at : current.booking_closes_at;
    if (bookingClosesAt && new Date(String(bookingClosesAt)).getTime() >= dateStart.getTime()) {
      return NextResponse.json({ error: 'La fin des réservations doit être antérieure au début de l’événement.' }, { status: 400 });
    }
  }

  if (patch.checkin_opens_at !== undefined || patch.checkin_closes_at !== undefined) {
    const { data: current } = await supabase
      .from('events')
      .select('*')
      .eq('id', params.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: 'Événement introuvable.' }, { status: 404 });
    const openAt = patch.checkin_opens_at !== undefined ? patch.checkin_opens_at : current.checkin_opens_at;
    const closeAt = patch.checkin_closes_at !== undefined ? patch.checkin_closes_at : current.checkin_closes_at;
    if (openAt && closeAt && new Date(String(closeAt)).getTime() < new Date(String(openAt)).getTime()) {
      return NextResponse.json({ error: 'La fermeture du contrôle doit être postérieure à son ouverture.' }, { status: 400 });
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
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'Un événement avec ce slug existe déjà.' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  revalidatePath(`/evenementiel/evenements/${data.slug}`);
  revalidatePath('/evenementiel');
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { count } = await supabase.from('event_reservations').select('id', { count: 'exact', head: true }).eq('event_id', params.id);
  if (count && count > 0) {
    return NextResponse.json({ error: 'Impossible de supprimer un événement ayant des réservations — annulez-le plutôt.' }, { status: 409 });
  }

  const { data: eventRow } = await supabase.from('events').select('slug').eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  const { error } = await supabase.from('events').delete().eq('id', params.id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (eventRow) revalidatePath(`/evenementiel/evenements/${eventRow.slug}`);
  revalidatePath('/evenementiel');
  return NextResponse.json({ success: true });
}
