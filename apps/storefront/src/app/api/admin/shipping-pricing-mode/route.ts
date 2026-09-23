/**
 * GET   /api/admin/shipping-pricing-mode → mode de tarification + repli (shipping.view)
 * PATCH /api/admin/shipping-pricing-mode (shipping.manage)
 *   { mode: 'shadow' }         → active la collecte shadow (refusé si un tarif est actif) ;
 *   { mode: 'provider_cost' }  → désactive la collecte, ou, en mode `tariff`, retire
 *                                TOUS les tarifs actifs et revient au calcul provider
 *                                (RPC atomique, commandes passées inchangées) ;
 *   { fallback: 'unavailable' | 'provider_cost' } → repli quand le forfait ne s'applique pas ;
 *   { publicGrid: boolean }    → affiche ou masque la page publique /livraison.
 *
 * Le mode `tariff` ne s'obtient QUE par l'activation explicite d'une version
 * (POST /api/admin/shipping-tariff-versions/:id/activate).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';
import { loadPricingMode, loadTariffFallback } from '@/lib/shipping/tariff/adminData';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const supabase = createServiceClient();
  const [mode, fallback] = await Promise.all([loadPricingMode(supabase, tenant.id), loadTariffFallback(supabase, tenant.id)]);
  return NextResponse.json({ mode, fallback, migrationReady: mode !== null, activationReady: fallback !== null });
}

export async function PATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { mode?: unknown; fallback?: unknown; confirm?: unknown; publicGrid?: unknown } | null;
  const supabase = createServiceClient();

  if (body?.publicGrid !== undefined) {
    if (typeof body.publicGrid !== 'boolean') return NextResponse.json({ error: 'Valeur invalide.' }, { status: 400 });
    if (await loadTariffFallback(supabase, tenant.id) === null) {
      return NextResponse.json({ error: 'Migration 125 non appliquée : page publique indisponible.' }, { status: 409 });
    }
    const { error } = await supabase.from('tenants').update({ shipping_public_grid_enabled: body.publicGrid }).eq('id', tenant.id);
    if (error) return NextResponse.json({ error: 'Mise à jour impossible.' }, { status: 500 });
    console.info('[shipping-pricing-mode] tenant:', tenant.id, '— page publique →', body.publicGrid);
    return NextResponse.json({ publicGrid: body.publicGrid });
  }

  if (body?.fallback !== undefined) {
    if (body.fallback !== 'unavailable' && body.fallback !== 'provider_cost') {
      return NextResponse.json({ error: 'Repli invalide.' }, { status: 400 });
    }
    if (await loadTariffFallback(supabase, tenant.id) === null) {
      return NextResponse.json({ error: 'Migration 125 non appliquée : repli indisponible.' }, { status: 409 });
    }
    const { error } = await supabase.from('tenants').update({ shipping_tariff_fallback: body.fallback }).eq('id', tenant.id);
    if (error) return NextResponse.json({ error: 'Mise à jour impossible.' }, { status: 500 });
    console.info('[shipping-pricing-mode] tenant:', tenant.id, '— repli →', body.fallback);
    return NextResponse.json({ fallback: body.fallback });
  }

  const mode = body?.mode;
  if (mode !== 'provider_cost' && mode !== 'shadow') {
    return NextResponse.json({ error: 'Le forfait client s’active uniquement depuis une version tarifaire.' }, { status: 400 });
  }

  const current = await loadPricingMode(supabase, tenant.id);
  if (current === null) {
    return NextResponse.json({ error: 'Migration 124 non appliquée : collecte shadow indisponible.' }, { status: 409 });
  }

  if (current === 'tariff') {
    if (mode === 'shadow') {
      return NextResponse.json({ error: 'Retirez d’abord la tarification active avant de relancer une collecte shadow.' }, { status: 409 });
    }
    if (body?.confirm !== true) {
      return NextResponse.json({ error: 'Confirmation explicite requise pour revenir au calcul actuel.' }, { status: 400 });
    }
    const adminId = await getAdminId();
    const { error } = await supabase.rpc('rollback_shipping_tariff_to_provider_cost', { p_tenant_id: tenant.id, p_actor_id: adminId });
    if (error) return NextResponse.json({ error: 'Retour au calcul actuel impossible.' }, { status: 500 });
    console.info('[shipping-pricing-mode] tenant:', tenant.id, '— rollback tariff → provider_cost — admin:', adminId);
    return NextResponse.json({ mode: 'provider_cost' });
  }

  if (mode === 'shadow') {
    const { count, error } = await supabase
      .from('shipping_tariff_versions')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('status', 'shadow');
    if (error) return NextResponse.json({ error: 'Vérification des versions impossible.' }, { status: 500 });
    if (!count) return NextResponse.json({ error: 'Sélectionnez d’abord une version shadow.' }, { status: 409 });
  }

  const { error } = await supabase.from('tenants').update({ shipping_pricing_mode: mode }).eq('id', tenant.id);
  if (error) return NextResponse.json({ error: 'Mise à jour impossible.' }, { status: 500 });
  console.info('[shipping-pricing-mode] tenant:', tenant.id, '→', mode);
  return NextResponse.json({ mode });
}
