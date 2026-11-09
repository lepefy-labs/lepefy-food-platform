/**
 * GET /api/admin/shipping-packaging-weight → tranches du tenant (shipping.view)
 * PUT /api/admin/shipping-packaging-weight (shipping.manage)
 *   { bands: [{ maxWeightG: number | null, addedWeightG: number }] } — liste
 *   complète triée, dernière tranche ouverte ; liste vide = désactivé.
 *
 * Le tenant vient toujours de getTenant(), jamais du corps. Écriture atomique
 * par RPC (migration 180) ; migration absente → 409, rien n'est écrit.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { getCurrentAdminAccessContext } from '@/lib/auth/adminRbac';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import { loadPackagingWeightBands } from '@/lib/shipping/loadPackagingWeightBands';
import { bandsToRows, parsePackagingWeightBandsInput } from '@/lib/shipping/packagingWeight';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

const MISSING_RPC_CODES = new Set(['42883', 'PGRST202', '42P01', 'PGRST205']);

export async function GET() {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  try {
    return NextResponse.json({ bands: await loadPackagingWeightBands(createServiceClient(), tenant.id) });
  } catch {
    return NextResponse.json({ error: 'Lecture impossible.' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const body = await req.json().catch(() => null) as { bands?: unknown } | null;
  const parsed = parsePackagingWeightBandsInput(body?.bands);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const access = await getCurrentAdminAccessContext(tenant.id);
  const { error } = await createServiceClient().rpc('replace_shipping_packaging_weight_bands', {
    p_tenant_id: tenant.id, p_bands: bandsToRows(parsed.bands), p_actor_id: access?.userId ?? null,
  });
  if (error) {
    if (MISSING_RPC_CODES.has((error as { code?: string }).code ?? '')) {
      return NextResponse.json({ error: 'Migration 180 non appliquée.' }, { status: 409 });
    }
    console.error('[shipping-packaging-weight] save failed — tenant:', tenant.id, '— code:', (error as { code?: string }).code);
    return NextResponse.json({ error: 'Enregistrement impossible.' }, { status: 500 });
  }

  if (access) {
    await recordAuditEvent({
      tenantId: tenant.id, eventType: 'shipping.packaging_weight.updated', actor: access,
      resourceType: 'shipping_packaging_weight', resourceLabel: 'Poids d’emballage',
      metadata: { bands: bandsToRows(parsed.bands) },
    });
  }
  return NextResponse.json({ bands: parsed.bands });
}
