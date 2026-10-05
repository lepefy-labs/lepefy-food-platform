import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { getTenantServiceState, isModuleAvailable } from '@/lib/billing/tenantServiceState';
import { isWellFormedPortalToken } from '@/lib/orders/portal/orderPublicToken';
import { loadReorderProposal } from '@/lib/orders/portal/loadOrderPortal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/**
 * GET /api/order-portal/[token]/reorder — proposition de riordino en lecture
 * seule (aucune écriture : ni panier serveur, ni commande). Le client l'ajoute
 * ensuite à son panier par le flux normal ; le checkout revalide tout.
 */
export async function GET(_request: Request, { params }: { params: { token: string } }) {
  if (!isWellFormedPortalToken(params.token)) return NextResponse.json({ error: 'Lien indisponible.' }, { status: 404, headers: NO_STORE });
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  if (!isModuleAvailable(await getTenantServiceState(tenant.id), 'shop')) {
    return NextResponse.json({ error: 'La boutique est momentanément indisponible.' }, { status: 503, headers: NO_STORE });
  }
  try {
    const proposal = await loadReorderProposal(createServiceClient(), tenant.id, params.token);
    if (!proposal) return NextResponse.json({ error: 'Lien indisponible.' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(proposal, { headers: NO_STORE });
  } catch (error) {
    console.error('[order-portal] reorder proposal failed', tenant.id, error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'Impossible de préparer votre panier. Réessayez.' }, { status: 503, headers: NO_STORE });
  }
}
