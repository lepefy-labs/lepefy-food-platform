import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isAuthorizedInternalRequest } from '@/lib/whatsapp/server/internalAuth';
import { processPendingWhatsAppMessages } from '@/lib/whatsapp/server/processing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({ messageIds: z.array(z.string().uuid()).min(1).max(50) }).strict();

/**
 * Traitement des messages WhatsApp entrants confiés à n8n
 * (ops/n8n/whatsapp-inbound-dispatch.json). Reçoit uniquement des UUID :
 * le tenant, la conversation et le canal sont relus en base. Idempotent : un
 * message déjà traité ou en cours n'est pas re-claimé.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedInternalRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 });
  try {
    const result = await processPendingWhatsAppMessages({ messageIds: parsed.data.messageIds });
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ ok: false, error: 'process_failed' }, { status: 500 });
  }
}
