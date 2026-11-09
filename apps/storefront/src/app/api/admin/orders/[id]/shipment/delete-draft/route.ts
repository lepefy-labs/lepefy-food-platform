import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { ShippingProviderError } from '@/lib/shipping/providers/types';
import { deleteShipmentDraftAtProvider } from '@/lib/shipping/shipmentDraft/shipmentDraftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  still_exists: 'Le transporteur indique que le brouillon existe toujours : la référence reste sur la commande.',
  not_deletable: 'Ce brouillon a déjà été complété ou acheté chez le transporteur : il ne peut plus être supprimé depuis Lepefy.',
  no_draft: 'Aucun brouillon créé depuis Lepefy n’est associé à cette commande.',
  provider_unsupported: 'Votre transporteur ne permet pas cette suppression.',
  order_inactive: 'Cette commande ne peut plus être modifiée.',
  in_transit: 'Le colis est déjà pris en charge par le transporteur : le brouillon ne peut plus être supprimé.',
};

const PROVIDER_MESSAGES: Record<string, string> = {
  draft_delete_forbidden: 'La clé du transporteur ne permet pas de supprimer ce brouillon : supprimez-le dans son back-office.',
  draft_delete_rejected: 'Le transporteur a refusé la suppression : supprimez le brouillon dans son back-office.',
};

/**
 * POST /api/admin/orders/[id]/shipment/delete-draft (orders.manage).
 * Supprime chez le transporteur un brouillon créé par Lepefy et non acheté,
 * puis retire la référence une fois l'absence du brouillon vérifiée.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const headers = { 'Cache-Control': 'no-store' };
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  try {
    const result = await deleteShipmentDraftAtProvider(createServiceClient(), tenant.id, params.id);
    if (result.outcome === 'released') return NextResponse.json({ ok: true }, { headers });
    if (result.outcome === 'busy') {
      return NextResponse.json({ error: 'La commande a été modifiée. Actualisez et réessayez.' }, { status: 409, headers });
    }
    const code = result.outcome === 'still_exists' ? 'still_exists' : result.reason;
    return NextResponse.json({ error: MESSAGES[code] ?? 'Opération indisponible.', code }, { status: 409, headers });
  } catch (error) {
    const code = error instanceof ShippingProviderError ? error.code : 'route_error';
    console.error(`[shipping/draft] failed — tenant_id: ${tenant.id} — order_id: ${params.id} — code: delete_${code}`);
    const message = PROVIDER_MESSAGES[code] ?? 'Transporteur injoignable : rien n’a été retiré de la commande. Réessayez plus tard.';
    return NextResponse.json({ error: message, code }, { status: code in PROVIDER_MESSAGES ? 409 : 503, headers });
  }
}
