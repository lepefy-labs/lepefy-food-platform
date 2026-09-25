import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantPaymentMethods } from '@/lib/tenant/getTenantPaymentMethods';
import { buildPublicPreorderView, loadSessionByPayToken } from '@/lib/orders/assisted/payLinkPublic';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Lecture publique d'une précommande par son jeton (sans compte ni login).
 * Utilisée pour le polling après paiement : le statut « completed » ne vient
 * que du webhook Stripe / de la confirmation admin, jamais du navigateur.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const supabase = createServiceClient();
  const session = await loadSessionByPayToken(supabase, tenant.id, params.token).catch(() => null);
  if (!session) {
    return NextResponse.json({ error: 'Ce lien de paiement n\'est pas ou plus valide.' }, { status: 404, headers: NO_STORE });
  }
  const methods = await getTenantPaymentMethods(tenant.id);
  const view = await buildPublicPreorderView(supabase, tenant, session, methods);
  return NextResponse.json({ preorder: view }, { headers: NO_STORE });
}
