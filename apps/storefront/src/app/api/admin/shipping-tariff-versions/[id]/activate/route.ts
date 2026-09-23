/**
 * POST /api/admin/shipping-tariff-versions/:id/activate  (shipping.manage)
 * Body: { confirm: true, acknowledgePerOrderSurcharges?: boolean }
 *
 * « Activer cette tarification pour les clients » : la version devient `active`
 * pour son pays (l'ancienne est retirée) et le tenant passe en mode `tariff`,
 * en une transaction (RPC activate_shipping_tariff_version). Les nouveaux
 * devis et checkouts facturent ce tarif ; les commandes existantes gardent leur
 * snapshot. Refusé sans confirmation explicite ou si un point bloquant subsiste.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import type { ShippingTariffVersionRow } from '@lepefy/types';
import { resolveCountryRule } from '@/lib/shipping/resolveCountryRule';
import { loadForfaitShadowAdminData } from '@/lib/shipping/tariff/adminData';
import { activationBlockers, buildActivationChecklist, perOrderSurchargeZones } from '@/lib/shipping/tariff/activationChecklist';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { confirm?: unknown; acknowledgePerOrderSurcharges?: unknown } | null;
  if (body?.confirm !== true) {
    return NextResponse.json({ error: 'Confirmation explicite requise pour facturer ce tarif aux clients.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const data = await loadForfaitShadowAdminData(supabase, tenant.id);
  const version = data.versions.find((v) => v.id === params.id) as ShippingTariffVersionRow | undefined;
  if (!version) return NextResponse.json({ error: 'Version introuvable.' }, { status: 404 });
  if (version.status === 'active') return NextResponse.json({ error: 'Cette version est déjà active.' }, { status: 409 });

  const checklist = buildActivationChecklist({
    version,
    migrationReady: data.activationReady,
    missingWeightProducts: data.missingWeightProducts.length,
    zoneCodes: data.zoneCodes,
    profiles: data.profiles,
    countryRule: resolveCountryRule(version.country, data.countryRules),
    fallback: data.fallback,
  });
  const blockers = activationBlockers(checklist);
  if (blockers.length > 0) {
    return NextResponse.json({ error: blockers.map((b) => `${b.label} : ${b.detail}`).join(' '), checklist }, { status: 409 });
  }
  if (perOrderSurchargeZones(version).length > 0 && body.acknowledgePerOrderSurcharges !== true) {
    return NextResponse.json({ error: 'Cette version contient des suppléments « par commande » : confirmez-les explicitement.', checklist }, { status: 409 });
  }

  const adminId = await getAdminId();
  const { data: activated, error } = await supabase.rpc('activate_shipping_tariff_version', {
    p_tenant_id: tenant.id,
    p_version_id: version.id,
    p_actor_id: adminId,
  });
  if (error) {
    console.error('[shipping-tariff-versions] activation failed — tenant:', tenant.id, '— code:', (error as { code?: string }).code);
    return NextResponse.json({ error: 'Activation impossible.' }, { status: 500 });
  }
  console.info('[shipping-tariff-versions] tarif activé — tenant:', tenant.id, '— version:', version.id, '— admin:', adminId);
  return NextResponse.json({ version: activated, pricingMode: 'tariff' });
}
