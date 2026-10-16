import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isNotificationChannel, type NotificationChannel } from '@/lib/notifications/notificationTypes';
import { BACKFILL_LIST, previewBackfill } from '@/lib/notifications/staff/backfill';
import { BACKFILL_MAX_ORDERS } from '@/lib/notifications/staff/backfillPlan';
import { requireBackfillApi } from '@/lib/notifications/staff/backfillApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Catch-up preview (platform owner): exact plan for the selection, recorded as
 * a `previewed` run valid 15 minutes. Nothing is sent here.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    tenantId?: unknown; idempotencyKey?: unknown; orderIds?: unknown; allMatching?: unknown; channels?: unknown; mode?: unknown;
  } | null;
  const guard = await requireBackfillApi(body?.tenantId);
  if (!guard.ok) return guard.response;

  const idempotencyKey = typeof body?.idempotencyKey === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(body.idempotencyKey) ? body.idempotencyKey : null;
  const channels = Array.isArray(body?.channels) ? Array.from(new Set(body.channels.filter(isNotificationChannel))) as NotificationChannel[] : [];
  const mode = body?.mode === 'summary' ? 'summary' : body?.mode === 'individual' ? 'individual' : null;
  const orderIds = Array.isArray(body?.orderIds) ? body.orderIds.filter((id): id is string => typeof id === 'string' && UUID.test(id)) : undefined;
  const allMatching = body?.allMatching && typeof body.allMatching === 'object'
    ? BACKFILL_LIST.parse(body.allMatching as Record<string, string>) : undefined;
  if (!idempotencyKey || channels.length === 0 || !mode || (!orderIds?.length && !allMatching)) {
    return NextResponse.json({ error: 'Sélection, canaux ou mode invalides.' }, { status: 400 });
  }
  if (orderIds && orderIds.length > BACKFILL_MAX_ORDERS) {
    return NextResponse.json({ error: `Au plus ${BACKFILL_MAX_ORDERS} commandes par rattrapage.` }, { status: 400 });
  }

  try {
    const result = await previewBackfill(createServiceClient(), {
      tenantId: guard.tenantId, actor: guard.actor, idempotencyKey,
      request: { orderIds: allMatching ? undefined : orderIds, allMatching, channels, mode },
    });
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[backfill/preview] failed —', (error as { code?: string } | null)?.code ?? (error instanceof Error ? error.message : 'unknown'));
    return NextResponse.json({ error: 'Aperçu impossible : réessayez.' }, { status: 500 });
  }
}
