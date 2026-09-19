/**
 * GET /api/admin/shipping-observations/summary
 * Agrégats lisibles pour l'onglet "Historique des coûts" — voir
 * observationsSummary.ts pour le calcul, partagé avec la page serveur.
 */
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { buildObservationsSummary } from '@/lib/shipping/intelligence/observationsSummary';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export async function GET() {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);

  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const supabase = createServiceClient();
  const summary = await buildObservationsSummary(supabase, tenant.id);
  return NextResponse.json(summary);
}
