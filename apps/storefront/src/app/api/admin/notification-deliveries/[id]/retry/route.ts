import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { sendNotification } from '@/lib/events/notifyN8n';
import { recordAttemptResult, type DeliveryRow } from '@/lib/notifications/deliveryLedger';

export const runtime = 'nodejs';

/**
 * Manual retry of a failed or abandoned delivery. The row is claimed with a
 * compare-and-set on its status, so a concurrent scheduler run cannot send it
 * at the same time; three more automatic attempts are granted afterwards.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const slug = process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood';
  const tenant = await getTenant(slug);
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;

  const db = createServiceClient();
  const { data: current } = await db.from('notification_deliveries').select('attempts, status, payload')
    .eq('id', params.id).eq('tenant_id', tenant.id).maybeSingle();
  if (!current) return NextResponse.json({ error: 'Envoi introuvable.' }, { status: 404 });
  if (!['failed', 'dead'].includes(current.status) || current.payload == null) {
    return NextResponse.json({ error: 'Cet envoi ne peut pas être relancé.' }, { status: 409 });
  }

  const attempts = current.attempts + 1;
  const { data: claimed } = await db.from('notification_deliveries').update({
    status: 'processing', attempts, max_attempts: Math.min(attempts + 3, 20),
    locked_until: new Date(Date.now() + 2 * 60_000).toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', params.id).eq('tenant_id', tenant.id).eq('status', current.status)
    .select('id, tenant_id, webhook_path, payload, attempts, max_attempts').maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'Envoi déjà en cours de traitement.' }, { status: 409 });

  const row = claimed as DeliveryRow;
  const outcome = row.payload ? await sendNotification(row.webhook_path, row.payload) : { ok: false, error: 'payload_missing' };
  await recordAttemptResult(db, row, outcome);
  return NextResponse.json({ accepted: outcome.ok, error: outcome.ok ? undefined : outcome.error });
}
