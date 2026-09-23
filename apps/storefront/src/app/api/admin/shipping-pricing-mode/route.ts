/**
 * GET   /api/admin/shipping-pricing-mode → mode de tarification (shipping.view)
 * PATCH /api/admin/shipping-pricing-mode { mode: 'provider_cost' | 'shadow' } (shipping.manage)
 *
 * Active ou désactive UNIQUEMENT la collecte shadow. `tariff` (tarification
 * facturée) est refusé en V1F. Le montant payé par le client ne change dans
 * aucun des deux modes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { loadPricingMode } from '@/lib/shipping/tariff/adminData';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const mode = await loadPricingMode(createServiceClient(), tenant.id);
  return NextResponse.json({ mode, migrationReady: mode !== null });
}

export async function PATCH(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { mode?: unknown } | null;
  const mode = body?.mode;
  if (mode !== 'provider_cost' && mode !== 'shadow') {
    return NextResponse.json({ error: 'Seule la collecte shadow peut être activée ou désactivée ici.' }, { status: 400 });
  }

  const supabase = createServiceClient();
  if (await loadPricingMode(supabase, tenant.id) === null) {
    return NextResponse.json({ error: 'Migration 124 non appliquée : collecte shadow indisponible.' }, { status: 409 });
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
