import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isSupportCategory, isSupportManualChannel, isSupportPriority } from '@/lib/support/domain';
import { deriveTitle, isUuid } from '@/lib/support/rules';
import { readJsonBody, supportPlatformApi } from '@/lib/support/server/access';
import { parseAttachmentIds, parseClientKey, parseMessageText } from '@/lib/support/server/input';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Request received elsewhere (WhatsApp, phone, e-mail) entered by Lepefy for a
 * shop. The message is recorded as relayed by Lepefy from that channel, with
 * the original date — never as written by the shop.
 */
export async function POST(request: Request) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request, 24_000);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  if (!isUuid(body.tenantId)) return NextResponse.json({ error: 'Choisissez la boutique.' }, { status: 400 });
  if (!isSupportManualChannel(body.channel)) return NextResponse.json({ error: 'Choisissez le canal d’origine.' }, { status: 400 });
  const parsed = parseMessageText(body.text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const attachmentIds = parseAttachmentIds(body.attachmentIds);
  if (!attachmentIds) return NextResponse.json({ error: 'Cinq captures au maximum.' }, { status: 400 });
  const reportedAt = typeof body.reportedAt === 'string' && !Number.isNaN(Date.parse(body.reportedAt)) ? new Date(body.reportedAt).toISOString() : null;
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 140) : deriveTitle(parsed.text);

  const db = createServiceClient();
  const { data: tenant } = await db.from('tenants').select('id').eq('id', body.tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Boutique introuvable.' }, { status: 404 });

  const { data, error } = await db.rpc('support_create_ticket', {
    p_tenant_id: body.tenantId,
    p_actor_type: 'lepefy',
    p_actor_admin_id: guard.adminId,
    p_actor_label: guard.label,
    p_title: title,
    p_body: parsed.text,
    p_category: isSupportCategory(body.category) ? body.category : 'unspecified',
    p_declared_urgent: false,
    p_priority: isSupportPriority(body.priority) ? body.priority : 'normal',
    p_context: {},
    p_source_channel: body.channel,
    p_external_reference: typeof body.externalReference === 'string' ? body.externalReference : null,
    p_reported_at: reportedAt,
    p_requester_label: typeof body.requesterLabel === 'string' ? body.requesterLabel : null,
    p_visible: body.visible !== false,
    p_client_key: parseClientKey(body.clientKey),
    p_attachment_ids: attachmentIds,
  });
  if (error) return supportErrorResponse(error, 'La demande n’a pas pu être créée. Réessayez.');
  const row = (data as Array<{ out_ticket_id: string; out_number: number; out_created: boolean }> | null)?.[0];
  if (!row) return NextResponse.json({ error: 'La demande n’a pas pu être créée.' }, { status: 500 });
  return NextResponse.json({ ticket: { id: row.out_ticket_id, number: row.out_number }, created: row.out_created }, { status: row.out_created ? 201 : 200 });
}
