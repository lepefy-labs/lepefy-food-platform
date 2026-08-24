import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { createOrderFromCheckoutSession, type CheckoutSessionRow } from '@/lib/orders/createOrderFromCheckoutSession';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const tenantSlug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(tenantSlug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: session, error: sessionError } = await supabase
    .from('checkout_sessions')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .eq('status', 'open')
    .gt('expires_at', nowIso)
    .eq('payment_method', 'external_link')
    .maybeSingle() as { data: CheckoutSessionRow | null; error: unknown };

  if (sessionError) {
    console.error('[admin/checkout-sessions/confirm-payment] fetch error:', sessionError, '— id:', params.id);
    return NextResponse.json({ error: 'Erreur serveur.' }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json(
      { error: 'Demande de paiement introuvable, expirée ou déjà traitée.' },
      { status: 404 },
    );
  }

  const result = await createOrderFromCheckoutSession(supabase, session);
  if ('error' in result) {
    console.error('[admin/checkout-sessions/confirm-payment] createOrderFromCheckoutSession failed:', result.error, '— session:', params.id);
    return NextResponse.json({ error: 'Erreur lors de la création de la commande.' }, { status: 500 });
  }

  if (result.order.status === 'stock_conflict') {
    return NextResponse.json({
      order: result.order,
      warning:
        'Commande créée, mais le stock manquait au moment de la confirmation. ' +
        'Aucun remboursement automatique n\'est possible pour ce moyen de paiement — ' +
        'contactez le client et remboursez-le manuellement via PayPal/Revolut.',
    });
  }

  console.info('[admin/checkout-sessions/confirm-payment] Order created — id:', result.order.id, '— session:', params.id);
  revalidatePath('/admin');
  revalidatePath('/admin/checkout-funnel');

  return NextResponse.json({ order: result.order });
}
