/**
 * POST /api/admin/shipping-tariff-versions/:id/select
 * Sélectionne une version comme version shadow de son pays (retire l'ancienne
 * dans la même transaction SQL). Sert aussi de rollback vers une version
 * précédente. N'active jamais une tarification facturée (shipping.manage).
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc('select_shipping_tariff_shadow_version', {
    p_tenant_id: tenant.id,
    p_version_id: params.id,
  });
  if (error) {
    const notFound = (error as { code?: string }).code === 'P0002';
    return NextResponse.json({ error: notFound ? 'Version introuvable.' : 'Sélection impossible.' }, { status: notFound ? 404 : 500 });
  }
  return NextResponse.json({ version: data });
}
