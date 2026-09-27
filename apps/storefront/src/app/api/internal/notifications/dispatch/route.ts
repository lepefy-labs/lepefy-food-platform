import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { postToN8n } from '@/lib/events/notifyN8n';
import { dispatchDueDeliveries } from '@/lib/notifications/deliveryLedger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Retries failed notification deliveries (migration 136). Called every
 * 5 minutes by the n8n workflow "Lepefy · Notification retry scheduler" with
 * the internal scheduler bearer shared with the daily digest dispatcher
 * (DAILY_DIGEST_CRON_SECRET).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.DAILY_DIGEST_CRON_SECRET ?? '';
  const provided = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
  if (!secret || !provided || Buffer.byteLength(secret) !== Buffer.byteLength(provided)
    || !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await dispatchDueDeliveries(postToN8n));
  } catch (error) {
    console.error('[notifications dispatch] failed:', error);
    return NextResponse.json({ error: 'Notification ledger unavailable' }, { status: 503 });
  }
}
