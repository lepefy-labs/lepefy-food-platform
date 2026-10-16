import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { dispatchDueDeliveries } from '@/lib/notifications/deliveryLedger';
import { routeDelivery } from '@/lib/notifications/deliveryRouter';
import { followUpWhatsappDeliveries } from '@/lib/notifications/whatsappFollowUp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sends queued and retries failed notification deliveries of every channel
 * (migrations 136/158), then follows WhatsApp messages up (interrupted sends
 * → unknown, delivery status from Green API). Called every
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
    const db = createServiceClient();
    const dispatched = await dispatchDueDeliveries(routeDelivery, db);
    const whatsapp = await followUpWhatsappDeliveries(db).catch((error: unknown) => {
      console.error('[notifications dispatch] whatsapp follow-up failed:', error instanceof Error ? error.message : error);
      return null;
    });
    return NextResponse.json({ ...dispatched, whatsapp });
  } catch (error) {
    console.error('[notifications dispatch] failed:', error);
    return NextResponse.json({ error: 'Notification ledger unavailable' }, { status: 503 });
  }
}
