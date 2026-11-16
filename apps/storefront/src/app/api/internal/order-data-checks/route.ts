/**
 * POST /api/internal/order-data-checks
 *
 * Contrôle horaire des données saisies par les clients (n8n, toutes les heures,
 * bearer ORDER_DATA_CHECKS_TOKEN, sinon CATALOG_SCHEDULE_SCHEDULER_TOKEN ;
 * jamais la clé service-role). Pour tous les tenants : commandes ouvertes dont l'adresse est
 * incomplète → e-mail « Commande à vérifier » une seule fois par anomalie.
 * Lecture seule sur les commandes. Aucun des deux jetons = tick refusé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { schedulerBearerAuthorized } from '@/lib/shipping/shippingSyncAuth';
import { runOrderDataChecks } from '@/lib/orders/dataQuality/orderDataCheckRun';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  // Dedicated token when set, otherwise the catalogue scheduler token (same n8n
  // credential « Lepefy · Catalogue schedule scheduler bearer »). Never the service-role key.
  const token = process.env.ORDER_DATA_CHECKS_TOKEN?.trim() || process.env.CATALOG_SCHEDULE_SCHEDULER_TOKEN;
  if (!schedulerBearerAuthorized(request.headers.get('authorization'), token, undefined)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  try {
    const summary = await runOrderDataChecks(createServiceClient());
    if (summary.failed > 0) console.error('[order-data-checks] alerts not queued —', summary.failed);
    return NextResponse.json({ ok: summary.failed === 0, ...summary }, { status: summary.failed > 0 ? 503 : 200, headers });
  } catch {
    console.error('[order-data-checks] tick unavailable');
    return NextResponse.json({ error: 'order_data_checks_unavailable' }, { status: 503, headers });
  }
}
