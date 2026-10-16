import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requirePlatformOwner } from '@/lib/auth/requirePlatformOwner';
import { recordAttemptResult, type DeliveryRow } from '@/lib/notifications/deliveryLedger';
import { routeDelivery } from '@/lib/notifications/deliveryRouter';
import { resolvePlatformTenantId } from '@/lib/notifications/platformTenant';

export const runtime = 'nodejs';

/**
 * Manual retry of a failed, abandoned or uncertain delivery (platform owner
 * only). The row is claimed with a compare-and-set on its status, so a
 * concurrent scheduler run cannot send it at the same time; three more
 * automatic attempts are granted afterwards. An `unknown` row (the provider
 * may already have the message) needs an explicit `confirmUncertain`.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const denied = await requirePlatformOwner();
  if (denied) return denied;
  const body = await req.json().catch(() => ({})) as { confirmUncertain?: unknown; tenantId?: unknown };
  const tenantId = await resolvePlatformTenantId(typeof body.tenantId === 'string' ? body.tenantId : null);
  if (!tenantId) return NextResponse.json({ error: 'Boutique introuvable.' }, { status: 404 });

  const db = createServiceClient();
  const { data: current } = await db.from('notification_deliveries').select('attempts, status, payload')
    .eq('id', params.id).eq('tenant_id', tenantId).maybeSingle();
  if (!current) return NextResponse.json({ error: 'Envoi introuvable.' }, { status: 404 });
  if (!['failed', 'dead', 'unknown'].includes(current.status) || current.payload == null) {
    return NextResponse.json({ error: 'Cet envoi ne peut pas être relancé.' }, { status: 409 });
  }
  if (current.status === 'unknown' && body.confirmUncertain !== true) {
    return NextResponse.json({ error: 'Résultat incertain : confirmez que le message n’a pas été reçu avant de relancer.' }, { status: 409 });
  }

  const attempts = current.attempts + 1;
  const { data: claimed } = await db.from('notification_deliveries').update({
    status: 'processing', attempts, max_attempts: Math.min(attempts + 3, 20),
    locked_until: new Date(Date.now() + 2 * 60_000).toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', params.id).eq('tenant_id', tenantId).eq('status', current.status)
    .select('id, tenant_id, webhook_path, payload, attempts, max_attempts').maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'Envoi déjà en cours de traitement.' }, { status: 409 });

  const row = claimed as DeliveryRow;
  const outcome = row.payload ? await routeDelivery(row.webhook_path, row.payload) : { ok: false, error: 'payload_missing' };
  await recordAttemptResult(db, row, outcome);
  return NextResponse.json({ accepted: outcome.ok, error: outcome.ok ? undefined : outcome.error });
}
