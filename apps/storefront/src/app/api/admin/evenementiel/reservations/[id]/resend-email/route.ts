import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { resendReservationConfirmation } from '@/lib/events/resendReservationConfirmation';

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Corrige (optionnellement) l'email d'une réservation événement puis
// renvoie la notification n8n '/webhook/event-reservation-confirmed' —
// mêmes garde-fous que refund/route.ts (requireAdmin + tenant check).
// Aucun nouveau qr_token, aucune capacité touchée : le client reçoit
// exactement le même billet.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();

  const { data: reservation, error: fetchError } = await supabase
    .from('event_reservations')
    .select('id, tenant_id, event_id, customer_email, status')
    .eq('id', params.id)
    .maybeSingle();

  if (fetchError) {
    console.error('[evenementiel/resend-email] fetch error:', fetchError, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!reservation || reservation.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'Réservation introuvable.' }, { status: 404 });
  }

  if (reservation.status !== 'confirmed') {
    return NextResponse.json(
      { error: 'Impossible de renvoyer un billet pour une réservation annulée ou remboursée.' },
      { status: 409 },
    );
  }

  const body = await req.json().catch(() => ({})) as { email?: string };
  let finalEmail = reservation.customer_email;

  if (body.email) {
    const trimmedEmail = body.email.trim();
    if (!isValidEmail(trimmedEmail)) {
      return NextResponse.json({ error: 'Adresse email invalide.' }, { status: 400 });
    }
    if (trimmedEmail !== reservation.customer_email) {
      const { error: updateError } = await supabase
        .from('event_reservations')
        .update({ customer_email: trimmedEmail })
        .eq('id', reservation.id);

      if (updateError) {
        console.error('[evenementiel/resend-email] Failed to update customer_email:', updateError, '— id:', reservation.id);
        return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
      }
      finalEmail = trimmedEmail;
    }
  }

  const result = await resendReservationConfirmation(supabase, reservation.id);

  if ('error' in result) {
    console.error('[evenementiel/resend-email] resendReservationConfirmation failed:', result.error, '— reservation:', reservation.id);
    return NextResponse.json({ error: 'Erreur lors du renvoi du billet.' }, { status: 500 });
  }

  revalidatePath(`/admin/evenementiel/evenements/${reservation.event_id}`);

  return NextResponse.json({ success: true, email: finalEmail });
}
