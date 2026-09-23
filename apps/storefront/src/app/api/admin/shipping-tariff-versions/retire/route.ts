/**
 * POST /api/admin/shipping-tariff-versions/retire  (shipping.manage)
 * Body: { country: 'IT', confirm: true }
 *
 * Retire la tarification active d'un pays. S'il ne reste aucune version
 * active, le tenant revient à `provider_cost`. Les commandes déjà passées
 * conservent leur snapshot ; les sessions ouvertes au forfait devront être
 * recalculées avant paiement.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getAdminId } from '@/lib/auth/getAdminId';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { country?: unknown; confirm?: unknown } | null;
  if (body?.confirm !== true || typeof body.country !== 'string' || !/^[A-Za-z]{2}$/.test(body.country)) {
    return NextResponse.json({ error: 'Pays et confirmation requis.' }, { status: 400 });
  }

  const adminId = await getAdminId();
  const { data: mode, error } = await createServiceClient().rpc('retire_shipping_tariff_country', {
    p_tenant_id: tenant.id,
    p_country: body.country.toUpperCase(),
    p_actor_id: adminId,
  });
  if (error) {
    console.error('[shipping-tariff-versions] retire failed — tenant:', tenant.id, '— code:', (error as { code?: string }).code);
    return NextResponse.json({ error: 'Retrait impossible.' }, { status: 500 });
  }
  console.info('[shipping-tariff-versions] tarif retiré — tenant:', tenant.id, '— pays:', body.country, '— admin:', adminId);
  return NextResponse.json({ pricingMode: mode });
}
