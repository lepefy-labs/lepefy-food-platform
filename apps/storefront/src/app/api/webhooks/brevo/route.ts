import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { eventKey, isAuthorizedBrevoWebhook, maskEmail, parseBrevoEvent, recipientHash } from '@/lib/notifications/brevoEvents';

/**
 * Brevo transactional webhook (docs/BREVO_EMAIL_ANALYTICS.md). Append-only
 * ingestion of delivery/open/click/bounce events; nothing here changes an order,
 * a payment or a notification. Attribution to a tenant happens at read time.
 *
 * Auth: `Authorization: Bearer <BREVO_WEBHOOK_TOKEN>`, fail closed. Responses
 * never echo the payload; logs carry counts and codes only, never an address.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;
const MAX_EVENTS = 100;
/** ~1 request in 200 also applies the 180-day retention (no scheduler needed). */
const PURGE_PROBABILITY = 0.005;

export async function POST(request: NextRequest) {
  if (!isAuthorizedBrevoWebhook(request.headers.get('authorization'), process.env.BREVO_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }); }

  const items = Array.isArray(body) ? body.slice(0, MAX_EVENTS) : [body];
  const secret = process.env.TRACKING_SECRET || process.env.BREVO_WEBHOOK_TOKEN!;
  const now = new Date();

  const rows: Array<Record<string, unknown>> = [];
  let ignored = 0;
  for (const item of items) {
    const parsed = parseBrevoEvent(item, now);
    if (!parsed.ok) { ignored += 1; continue; }
    const event = parsed.value;
    const hash = recipientHash(event.email, secret);
    rows.push({
      event_key: eventKey(event.messageId, hash, event.event, event.occurredAt),
      message_id: event.messageId,
      recipient_hash: hash,
      recipient_masked: maskEmail(event.email),
      event: event.event,
      raw_event: event.rawEvent,
      occurred_at: event.occurredAt.toISOString(),
      tags: event.tags,
      template_id: event.templateId,
      reason: event.reason,
      link_host: event.linkHost,
    });
  }

  const db = createServiceClient();
  if (rows.length > 0) {
    const { error } = await db.from('brevo_email_events').upsert(rows, { onConflict: 'event_key', ignoreDuplicates: true });
    if (error) {
      // 5xx: Brevo retries, and the dedupe key makes the retry harmless.
      console.error('[brevo-webhook] insert failed', error.code ?? 'unknown');
      return NextResponse.json({ error: 'storage_error' }, { status: 500 });
    }
  }

  if (Math.random() < PURGE_PROBABILITY) {
    try { await db.rpc('purge_brevo_email_events'); } catch { /* retention is best effort */ }
  }

  return NextResponse.json({ received: rows.length, ignored });
}

/** Brevo's "test" button and uptime probes only need to know the route exists. */
export function GET() {
  return NextResponse.json({ error: 'method_not_allowed' }, { status: 405 });
}
