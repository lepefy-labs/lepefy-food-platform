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

  // Formules soumises avec le formulaire de création — on les valide avant
  // toute écriture pour ne jamais créer un événement avec des formules
  // partiellement invalides.
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

  const supabase = createServiceClient();

  const { data: event, error } = await supabase
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

  if (ticketTypesInput.length > 0) {
    const { data: ticketTypes, error: ticketError } = await supabase
      .from('event_ticket_types')
      .insert(ticketTypesInput.map((t, i) => ({
        tenant_id:   tenant.id,
        event_id:    event.id,
        label:       t.label,
        description: t.description,
        price:       t.price,
        sort_order:  i,
      })))
      .select('*');

    if (ticketError) {
      // Compensation : l'événement ne doit pas rester orphelin de ses
      // formules si l'insertion échoue — pas de transaction multi-table
      // disponible côté supabase-js pour ce projet (voir 052_events_module.sql).
      // L'insert des formules ci-dessus est un unique appel PostgREST sur un
      // tableau de lignes (un seul statement SQL, atomique) : soit toutes les
      // formules sont créées, soit aucune — jamais un état partiel.
      const { error: cleanupError } = await supabase.from('events').delete().eq('id', event.id);
      if (cleanupError) {
        // Double échec (formules ET compensation) : l'événement orphelin
        // reste en base, sans formule. On le signale explicitement plutôt
        // que de laisser croire que tout a été annulé proprement.
        return NextResponse.json(
          { error: `Échec de la création des formules, et échec du nettoyage de l'événement associé (id: ${event.id}). Contactez un administrateur technique pour supprimer manuellement cet événement orphelin avant de réessayer.` },
          { status: 500 },
        );
      }
      return NextResponse.json({ error: ticketError.message }, { status: 500 });
    }

    return NextResponse.json({ ...event, ticket_types: ticketTypes ?? [] }, { status: 201 });
  }

  return NextResponse.json({ ...event, ticket_types: [] }, { status: 201 });
}
