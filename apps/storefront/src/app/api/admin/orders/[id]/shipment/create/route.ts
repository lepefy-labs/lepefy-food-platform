import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getTenant } from '@/lib/tenant/getTenant';
import { createServiceClient } from '@/lib/supabase/server';
import { ShippingProviderError } from '@/lib/shipping/providers/types';
import {
  createShipmentDraftForOrder, linkShipmentDraftReference, type DraftCreationOutcome,
} from '@/lib/shipping/shipmentDraft/shipmentDraftService';
import { shipmentDraftErrorMessage } from '@/lib/shipping/shipmentDraft/shipmentDraftPresentation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SKIP_MESSAGES: Record<string, string> = {
  disabled: 'La création des brouillons d’expédition n’est pas activée (Livraison → Expéditions).',
  provider_unsupported: 'Votre transporteur ne permet pas la création de brouillons depuis Lepefy.',
  not_delivery: 'Commande en retrait : aucune expédition à créer.',
  order_inactive: 'Cette commande ne peut pas recevoir de brouillon d’expédition.',
  manual_tracking: 'Le suivi manuel est actif pour cette commande.',
  existing_reference: 'Une expédition est déjà associée à cette commande.',
  requires_confirmation: 'Vérifiez d’abord dans le back-office du transporteur qu’aucun brouillon n’existe pour cette commande.',
  not_queued: 'Aucune création en attente.',
};

/**
 * POST /api/admin/orders/[id]/shipment/create (orders.manage, comme attach/sync/manual).
 * Corps : {} → créer ; { confirmNoExistingDraft: true } → recréer après un résultat incertain ;
 * { providerReference } → associer le brouillon trouvé chez le transporteur.
 * Le tenant vient toujours du déploiement et filtre la commande (isolation).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const headers = { 'Cache-Control': 'no-store' };
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body: unknown = await request.json().catch(() => ({}));
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => key !== 'confirmNoExistingDraft' && key !== 'providerReference')) {
    return NextResponse.json({ error: 'Corps invalide.' }, { status: 400, headers });
  }
  const { confirmNoExistingDraft, providerReference } = body as { confirmNoExistingDraft?: unknown; providerReference?: unknown };
  if (confirmNoExistingDraft !== undefined && typeof confirmNoExistingDraft !== 'boolean') {
    return NextResponse.json({ error: 'Corps invalide.' }, { status: 400, headers });
  }
  if (providerReference !== undefined && (typeof providerReference !== 'string' || !providerReference.trim() || providerReference.length > 100)) {
    return NextResponse.json({ error: 'Référence invalide.' }, { status: 400, headers });
  }

  try {
    const service = createServiceClient();
    const result: DraftCreationOutcome = typeof providerReference === 'string'
      ? await linkShipmentDraftReference(service, tenant.id, params.id, providerReference.trim())
      : await createShipmentDraftForOrder(service, tenant.id, params.id, { mode: 'manual', confirmNoExistingDraft: confirmNoExistingDraft === true });
    if (result.outcome === 'created') return NextResponse.json({ ok: true, reference: result.reference }, { headers });
    if (result.outcome === 'busy') {
      return NextResponse.json({ error: 'Une création est déjà en cours pour cette commande. Actualisez dans un instant.' }, { status: 409, headers });
    }
    if (result.outcome === 'skipped') {
      return NextResponse.json({ error: SKIP_MESSAGES[result.reason] ?? 'Création indisponible.', code: result.reason }, { status: 409, headers });
    }
    return NextResponse.json({ error: shipmentDraftErrorMessage(result.code), code: result.code, status: result.status }, { status: 422, headers });
  } catch (error) {
    if (error instanceof ShippingProviderError) {
      return NextResponse.json({ error: 'Référence introuvable chez le transporteur.', code: error.code }, { status: 422, headers });
    }
    console.error(`[shipping/draft] failed — tenant_id: ${tenant.id} — order_id: ${params.id} — code: route_error`);
    return NextResponse.json({ error: 'Création indisponible.' }, { status: 503, headers });
  }
}
