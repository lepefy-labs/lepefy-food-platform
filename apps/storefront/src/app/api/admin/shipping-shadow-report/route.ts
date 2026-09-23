/**
 * GET /api/admin/shipping-shadow-report?from=YYYY-MM-DD&to=YYYY-MM-DD&versionId=
 * Rapport shadow sur les commandes réelles du tenant (shipping.view).
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { loadShadowReport, reportPeriod } from '@/lib/shipping/tariff/shadowReport';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const period = reportPeriod(params.get('from'), params.get('to'));
  if (!period) return NextResponse.json({ error: 'Période invalide.' }, { status: 400 });
  const versionId = params.get('versionId') || null;

  const result = await loadShadowReport(createServiceClient(), tenant.id, { ...period, versionId });
  if ('error' in result) return NextResponse.json({ error: 'Lecture des commandes impossible.' }, { status: 500 });
  return NextResponse.json({ ...result, period });
}
