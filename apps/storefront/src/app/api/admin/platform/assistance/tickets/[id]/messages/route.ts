import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/support/rules';
import { readJsonBody, supportPlatformApi } from '@/lib/support/server/access';
import { parseAttachmentIds, parseClientKey, parseMessageText } from '@/lib/support/server/input';
import { platformTicketDetail } from '@/lib/support/server/platformService';
import { notifyTenantOfUpdate } from '@/lib/support/server/notify';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Reply to the shop (`message`) or internal note (`internal_note`, never visible to the shop). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const kind = body.kind === 'internal_note' ? 'internal_note' : 'message';
  const parsed = parseMessageText(body.text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const attachmentIds = parseAttachmentIds(body.attachmentIds);
  if (!attachmentIds) return NextResponse.json({ error: 'Cinq captures au maximum.' }, { status: 400 });

  const { data, error } = await createServiceClient().rpc('support_post_message', {
    p_ticket_id: params.id,
    p_tenant_id: null,
    p_actor_type: 'lepefy',
    p_actor_admin_id: guard.adminId,
    p_actor_label: guard.label,
    p_kind: kind,
    p_body: parsed.text,
    p_client_key: parseClientKey(body.clientKey),
    p_attachment_ids: attachmentIds,
    p_wait_for_tenant: kind === 'message' && body.waitForTenant === true,
  });
  if (error) return supportErrorResponse(error, 'Message non envoyé. Votre texte est conservé : réessayez.');
  const row = (data as Array<{ out_created: boolean; out_status: string }> | null)?.[0];
  if (row?.out_created && kind === 'message') await notifyTenantOfUpdate(params.id, row.out_status === 'waiting_tenant' ? 'waiting' : 'reply');
  const detail = await platformTicketDetail(params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ detail }, { status: row?.out_created ? 201 : 200 });
}
