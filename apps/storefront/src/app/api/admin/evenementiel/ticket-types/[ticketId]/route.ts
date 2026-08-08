import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

const EDITABLE_FIELDS = ['label', 'description', 'price', 'sort_order', 'active'] as const;

export async function PATCH(req: NextRequest, { params }: { params: { ticketId: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body  = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (body[field] === undefined) continue;
    patch[field] = body[field];
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
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { ticketId: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { count } = await supabase
    .from('event_reservation_items')
    .select('id', { count: 'exact', head: true })
    .eq('ticket_type_id', params.ticketId);

  if (count && count > 0) {
    // Des réservations existent déjà pour cette formule — on la désactive
    // plutôt que de la supprimer, pour ne jamais casser l'historique.
    const { data, error } = await supabase
      .from('event_ticket_types')
      .update({ active: false })
      .eq('id', params.ticketId)
      .eq('tenant_id', tenant.id)
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deactivated: true, ticketType: data });
  }

  const { error } = await supabase
    .from('event_ticket_types')
    .delete()
    .eq('id', params.ticketId)
    .eq('tenant_id', tenant.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, deactivated: false });
}
