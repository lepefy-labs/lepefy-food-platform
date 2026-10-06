import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { metaAppSecrets, webhookVerifyToken } from '@/lib/whatsapp/config';
import { ingestWebhookEvents } from '@/lib/whatsapp/ingestion';
import { whatsappLog } from '@/lib/whatsapp/log';
import { dispatchWhatsAppProcessing } from '@/lib/whatsapp/server/dispatch';
import { createIngestionStore } from '@/lib/whatsapp/server/stores';
import { verifyMetaSignature, verifySubscriptionRequest } from '@/lib/whatsapp/signature';
import { parseWhatsAppWebhook } from '@/lib/whatsapp/webhookPayload';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_000_000;

/**
 * Webhook public Meta WhatsApp Cloud API — unique pour tous les tenants.
 * Le tenant est résolu exclusivement côté serveur depuis le numéro professionnel
 * destinataire (metadata.phone_number_id -> tenant_whatsapp_channels), jamais
 * depuis le numéro du client ni depuis le déploiement qui reçoit la requête.
 * Docs : docs/WHATSAPP_BUSINESS_PLATFORM.md.
 */

/** Vérification d'abonnement (Meta App Dashboard › WhatsApp › Configuration). */
export async function GET(request: NextRequest) {
  const result = verifySubscriptionRequest(request.nextUrl.searchParams, webhookVerifyToken());
  if (!result.ok) {
    whatsappLog('webhook_rejected', { method: 'GET', status: result.status });
    return new NextResponse(null, { status: result.status });
  }
  return new NextResponse(result.challenge, { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const secrets = metaAppSecrets();
  if (secrets.length === 0) {
    // Fail closed : sans secret, impossible d'authentifier Meta.
    whatsappLog('webhook_rejected', { method: 'POST', reason: 'app_secret_missing' });
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) {
    whatsappLog('webhook_rejected', { method: 'POST', reason: 'too_large' });
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }
  if (!verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secrets)) {
    whatsappLog('webhook_rejected', { method: 'POST', reason: 'invalid_signature' });
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    whatsappLog('webhook_rejected', { method: 'POST', reason: 'invalid_json' });
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = parseWhatsAppWebhook(payload);
  whatsappLog('webhook_received', { recognized: parsed.recognized, events: parsed.events.length, ignored: parsed.ignored });
  if (!parsed.recognized || parsed.events.length === 0) return NextResponse.json({ received: true });

  let summary;
  try {
    summary = await ingestWebhookEvents(parsed.events, createIngestionStore(createServiceClient()), whatsappLog);
  } catch (error) {
    // Erreur de persistance : 500 pour que Meta réessaie (l'ingestion est idempotente).
    whatsappLog('processing_failed', { stage: 'ingest', error: error instanceof Error ? error.message.slice(0, 120) : 'unknown' });
    return NextResponse.json({ error: 'ingest_failed' }, { status: 500 });
  }

  await dispatchWhatsAppProcessing(summary.toProcess);
  return NextResponse.json({ received: true });
}
