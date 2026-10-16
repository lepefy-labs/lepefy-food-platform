import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getTenant } from '@/lib/tenant/getTenant';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import { isNotificationChannel } from '@/lib/notifications/notificationTypes';
import { greenApiErrorLabel } from '@/lib/notifications/providers/greenApiOutbound';
import { sendRecipientTest } from '@/lib/notifications/staff/testSend';

export const runtime = 'nodejs';

/** Test message to this recipient's own email or WhatsApp number ([TEST], one per minute). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const tenant = await getTenant(process.env.NEXT_PUBLIC_TENANT_SLUG ?? 'chloefood');
  const denied = await requireAdmin(tenant.id);
  if (denied) return denied;
  const body = await req.json().catch(() => null) as { channel?: unknown } | null;
  if (!isNotificationChannel(body?.channel)) return NextResponse.json({ error: 'Canal inconnu.' }, { status: 400 });

  const result = await sendRecipientTest(createServiceClient(), tenant.id, params.id, body.channel);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const outcome = result.outcome;
  if (outcome?.ok && !outcome.skipped) return NextResponse.json({ accepted: true, deliveryId: result.deliveryId });
  const reason = outcome?.skipped ? 'Envoi bloqué pour cette boutique de test.' : greenApiErrorLabel(outcome?.error) ?? 'Le message n’a pas été accepté par le transport.';
  return NextResponse.json({ accepted: false, deliveryId: result.deliveryId, error: reason, uncertain: outcome?.uncertain === true }, { status: 502 });
}
