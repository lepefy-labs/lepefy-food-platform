import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';

// Endpoint public (pas de requireAdmin) — appelé par le client lui-même
// depuis /en-attente quand il choisit de changer de moyen de paiement.
// Sécurité : id est un UUID v4 non devinable, même principe déjà en usage
// pour checkout-external-link et les autres liens opaques du module.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug   = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const supabase = createServiceClient();

  // Suppression atomique et conditionnée sur status = 'pending' — évite une
  // race condition avec une confirmation admin survenue entre-temps.
  const { data: deleted, error } = await supabase
    .from('event_reservation_requests')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[events/reservation-requests/delete] error:', error, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!deleted) {
    return NextResponse.json({ error: 'already_confirmed_or_not_found' }, { status: 409 });
  }

  return NextResponse.json({ success: true });
}
