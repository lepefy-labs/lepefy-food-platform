import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getDefaultEventCheckinClosesAt } from '@/lib/events/checkinWindow';
import type { EventStatus } from '@lepefy/types';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const VALID_STATUSES: EventStatus[] = ['draft', 'published', 'closed', 'cancelled'];

function isMissingClosingReportSchema(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === '42703' || error.code === 'PGRST204' || /booking_close_reports/i.test(error.message ?? '');
}

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const { data, error } = await createServiceClient().from('events').select('*').eq('tenant_id', tenant.id).order('date_start', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json() as Record<string, unknown>;
  const title = String(body.title ?? '').trim();
  const slugValue = String(body.slug ?? '').trim();
  const dateStart = String(body.date_start ?? '');
  const dateStartMs = new Date(dateStart).getTime();
  const capacityTotal = Number(body.capacity_total);
  const fallbackHours = body.booking_close_reports_fallback_hours === undefined
    ? 2
    : Number(body.booking_close_reports_fallback_hours);

  if (!title || !slugValue || !dateStart || Number.isNaN(dateStartMs) || !Number.isInteger(capacityTotal) || capacityTotal < 0) {
    return NextResponse.json({ error: 'Titre, slug, date et capacité valides requis.' }, { status: 400 });
  }
  if (!Number.isInteger(fallbackHours) || fallbackHours < 1 || fallbackHours > 168) {
    return NextResponse.json({ error: 'Le délai d’envoi des rapports doit être compris entre 1 et 168 heures.' }, { status: 400 });
  }

  const status: EventStatus = VALID_STATUSES.includes(body.status as EventStatus) ? body.status as EventStatus : 'draft';
  const rawTicketTypes = Array.isArray(body.ticket_types) ? body.ticket_types : [];
  const ticketTypesInput: { label: string; description: string | null; price: number }[] = [];
  for (const raw of rawTicketTypes) {
    const t = raw as Record<string, unknown>;
    const label = String(t.label ?? '').trim();
    const price = Number(t.price);
    if (!label || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'Chaque formule doit avoir un libellé et un prix valides.' }, { status: 400 });
    }
    ticketTypesInput.push({ label, description: t.description ? String(t.description).trim() : null, price });
  }
  if (status === 'published' && ticketTypesInput.length === 0) {
    return NextResponse.json({ error: 'Impossible de publier un événement sans au moins une formule.' }, { status: 400 });
  }

  const requestedCheckinClose = body.checkin_closes_at ? new Date(String(body.checkin_closes_at)) : null;
  if (requestedCheckinClose && (Number.isNaN(requestedCheckinClose.getTime()) || requestedCheckinClose.getTime() <= dateStartMs)) {
    return NextResponse.json({ error: 'La fin de validité des billets doit être postérieure au début de l’événement.' }, { status: 400 });
  }
  const checkinClosesAt = requestedCheckinClose?.toISOString() ?? getDefaultEventCheckinClosesAt(dateStart);

  const supabase = createServiceClient();
  const baseInsert = {
    tenant_id: tenant.id,
    slug: slugValue,
    title,
    description: body.description ? String(body.description).trim() : null,
    date_start: dateStart,
    location: body.location ? String(body.location).trim() : null,
    capacity_total: capacityTotal,
    capacity_remaining: capacityTotal,
    status,
    banner_image_url: body.banner_image_url ? String(body.banner_image_url) : null,
    checkin_closes_at: checkinClosesAt,
  };

  let result = await supabase.from('events').insert({ ...baseInsert, booking_close_reports_fallback_hours: fallbackHours }).select('*').single();
  if (result.error && isMissingClosingReportSchema(result.error)) {
    result = await supabase.from('events').insert(baseInsert).select('*').single();
  }
  const { data: event, error } = result;
  if (error || !event) {
    if ((error as { code?: string } | null)?.code === '23505') return NextResponse.json({ error: 'Un événement avec ce slug existe déjà.' }, { status: 409 });
    return NextResponse.json({ error: error?.message ?? 'Création impossible.' }, { status: 500 });
  }

  if (ticketTypesInput.length > 0) {
    const { data: ticketTypes, error: ticketError } = await supabase.from('event_ticket_types').insert(ticketTypesInput.map((t, i) => ({
      tenant_id: tenant.id, event_id: event.id, label: t.label, description: t.description, price: t.price, sort_order: i,
    }))).select('*');
    if (ticketError) {
      const { error: cleanupError } = await supabase.from('events').delete().eq('id', event.id);
      if (cleanupError) return NextResponse.json({ error: `Échec de la création des formules et du nettoyage de l'événement (id: ${event.id}).` }, { status: 500 });
      return NextResponse.json({ error: ticketError.message }, { status: 500 });
    }

    return NextResponse.json({ ...event, ticket_types: ticketTypes ?? [] }, { status: 201 });
  }

  return NextResponse.json({ ...event, ticket_types: [] }, { status: 201 });
}
