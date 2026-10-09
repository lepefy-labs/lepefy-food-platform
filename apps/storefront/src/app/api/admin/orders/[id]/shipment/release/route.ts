import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { ShippingProviderError } from '@/lib/shipping/providers/types';
import { releaseDeletedShipmentDraft } from '@/lib/shipping/shipmentDraft/shipmentDraftService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  still_exists: 'Le brouillon existe toujours chez le transporteur : supprimez-le d’abord dans le back-office du transporteur.',
  no_draft: 'Aucun brouillon créé depuis Lepefy n’est associé à cette commande.',
  provider_unsupported: 'Votre transporteur ne permet pas cette vérification.',
  order_inactive: 'Cette commande ne peut plus être modifiée.',
  in_transit: 'Le colis est déjà pris en charge par le transporteur : la référence ne peut plus être retirée.',
};

/**
 * POST /api/admin/orders/[id]/shipment/release (orders.manage).
 * Retire la référence d'un brouillon supprimé chez le transporteur, après
 * vérification auprès du provider ; Lepefy ne supprime jamais de brouillon.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const headers = { 'Cache-Control': 'no-store' };
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  try {
    const result = await releaseDeletedShipmentDraft(createServiceClient(), tenant.id, params.id);
    if (result.outcome === 'released') return NextResponse.json({ ok: true }, { headers });
    if (result.outcome === 'busy') {
      return NextResponse.json({ error: 'La commande a été modifiée. Actualisez et réessayez.' }, { status: 409, headers });
    }
    const code = result.outcome === 'still_exists' ? 'still_exists' : result.reason;
    return NextResponse.json({ error: MESSAGES[code] ?? 'Opération indisponible.', code }, { status: 409, headers });
  } catch (error) {
    const code = error instanceof ShippingProviderError ? error.code : 'route_error';
    console.error(`[shipping/draft] failed — tenant_id: ${tenant.id} — order_id: ${params.id} — code: release_${code}`);
    return NextResponse.json({ error: 'Vérification auprès du transporteur impossible. Réessayez plus tard.', code }, { status: 503, headers });
  }
}
