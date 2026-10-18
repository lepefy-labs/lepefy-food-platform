/**
 * POST /api/admin/shipping-tariff-versions/publish  (shipping.manage)
 * Body: {
 *   baseVersionId: uuid,            // version ACTIVE affichée dans l'éditeur
 *   bandPricesCents: number[],      // un prix par tranche, ordre de la base
 *   blockPriceCents: number | null, // null si la base n'a pas de bloc
 *   surchargesCents: { [zone_code]: number },
 *   confirm: true,
 * }
 *
 * « Modifier les tarifs » → « Vérifier et publier » : seuls les montants
 * changent. Le serveur reconstruit la version depuis la base (lib tariffEdit,
 * même règle que la RPC), repasse la validation et la checklist bloquante,
 * puis la RPC publish_shipping_tariff_version (migration 159) retire la base
 * et active la nouvelle version en une transaction. Base plus active → 409
 * TARIFF_BASE_CHANGED (autre admin, rollback) ; rien n'est écrit.
 * Les commandes passées gardent leur snapshot ; les paiements en cours sur
 * l'ancienne version reçoivent SHIPPING_REQUOTE_REQUIRED au checkout.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { resolveCountryRule } from '@/lib/shipping/resolveCountryRule';
import { loadForfaitShadowAdminData } from '@/lib/shipping/tariff/adminData';
import { activationBlockers, buildActivationChecklist } from '@/lib/shipping/tariff/activationChecklist';
import {
  buildEditedVersion, countryLabel, diffTariffPrices, TARIFF_EDIT_ERROR_LABELS, type TariffPriceEdits,
} from '@/lib/shipping/tariff/tariffEdit';
import { formatDate } from '@/lib/admin/format';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const BASE_CHANGED = 'Les tarifs de ce pays ont été modifiés entre-temps (par un autre administrateur ou une réactivation). Rien n’a été publié : rechargez les tarifs.';

function parseEdits(body: Record<string, unknown>): TariffPriceEdits | null {
  const bands = body.bandPricesCents;
  const surcharges = body.surchargesCents;
  if (!Array.isArray(bands) || !surcharges || typeof surcharges !== 'object' || Array.isArray(surcharges)) return null;
  if (body.blockPriceCents !== null && typeof body.blockPriceCents !== 'number') return null;
  return {
    bandPricesCents: bands as number[],
    blockPriceCents: body.blockPriceCents as number | null,
    surchargesCents: surcharges as Record<string, number>,
  };
}

export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.baseVersionId !== 'string') return NextResponse.json({ error: 'Version de départ manquante.' }, { status: 400 });
  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Confirmation explicite requise pour facturer ces prix aux clients.' }, { status: 400 });
  }
  const edits = parseEdits(body);
  if (!edits) return NextResponse.json({ error: TARIFF_EDIT_ERROR_LABELS.price_invalid, code: 'PRICE_INVALID' }, { status: 400 });

  const supabase = createServiceClient();
  const data = await loadForfaitShadowAdminData(supabase, tenant.id);
  const base = data.versions.find((v) => v.id === body.baseVersionId);
  if (!base) return NextResponse.json({ error: 'Version introuvable.' }, { status: 404 });
  if (base.status !== 'active') return NextResponse.json({ error: BASE_CHANGED, code: 'TARIFF_BASE_CHANGED' }, { status: 409 });

  const built = buildEditedVersion(base, edits);
  if (!built.ok) {
    return NextResponse.json({ error: built.errors.map((e) => TARIFF_EDIT_ERROR_LABELS[e]).join(' '), codes: built.errors }, { status: 400 });
  }
  const changes = diffTariffPrices(base, edits);
  if (changes.length === 0) return NextResponse.json({ error: 'Aucune modification à publier.', code: 'NO_CHANGE' }, { status: 409 });

  const blockers = activationBlockers(buildActivationChecklist({
    version: built.fields,
    migrationReady: data.activationReady,
    missingWeightProducts: data.missingWeightProducts.length,
    zoneCodes: data.zoneCodes,
    profiles: data.profiles,
    countryRule: resolveCountryRule(base.country, data.countryRules),
    fallback: data.fallback,
  }));
  if (blockers.length > 0) {
    return NextResponse.json({ error: blockers.map((b) => `${b.label} : ${b.detail}`).join(' ') }, { status: 409 });
  }

  const adminId = await getAdminId();
  const { data: published, error } = await supabase.rpc('publish_shipping_tariff_version', {
    p_tenant_id: tenant.id,
    p_base_version_id: base.id,
    p_bands: built.fields.bands,
    p_zone_surcharges: edits.surchargesCents,
    p_block_price_cents: built.fields.block_price_cents,
    p_name: `${countryLabel(base.country)} — prix du ${formatDate(new Date(), 'date')}`,
    p_actor_id: adminId,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message ?? '';
    if (code === 'PGRST202' || code === '42883') {
      return NextResponse.json({ error: 'Mise à jour indisponible : la migration 159 n’est pas encore appliquée. Aucun tarif n’a changé.', code: 'MIGRATION_MISSING' }, { status: 503 });
    }
    if (message.includes('tariff_base_not_active') || code === '23505') {
      return NextResponse.json({ error: BASE_CHANGED, code: 'TARIFF_BASE_CHANGED' }, { status: 409 });
    }
    if (message.includes('tariff_no_change')) return NextResponse.json({ error: 'Aucune modification à publier.', code: 'NO_CHANGE' }, { status: 409 });
    if (message.includes('tariff_structure_changed')) return NextResponse.json({ error: TARIFF_EDIT_ERROR_LABELS.structure_changed, code: 'STRUCTURE_CHANGED' }, { status: 409 });
    if (message.includes('tariff_price_invalid')) return NextResponse.json({ error: TARIFF_EDIT_ERROR_LABELS.price_invalid, code: 'PRICE_INVALID' }, { status: 400 });
    if (message.includes('tariff_version_not_found')) return NextResponse.json({ error: 'Version introuvable.' }, { status: 404 });
    console.error('[shipping-tariff-versions] publish failed — tenant:', tenant.id, '— code:', code);
    return NextResponse.json({ error: 'Publication impossible. Aucun tarif n’a changé : réessayez.' }, { status: 500 });
  }
  console.info('[shipping-tariff-versions] prix publiés — tenant:', tenant.id, '— base:', base.id, '— modifications:', changes.length, '— admin:', adminId);
  return NextResponse.json({ version: published, changes });
}
