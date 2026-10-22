import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/support/rules';
import { readJsonBody, supportTenantApi } from '@/lib/support/server/access';
import { parseAttachmentIds, parseClientKey, parseMessageText } from '@/lib/support/server/input';
import { tenantThread } from '@/lib/support/server/tenantService';
import { notifyPlatform } from '@/lib/support/server/notify';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Follow-up message of the shop. The client key makes a retry after a network error safe. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportTenantApi({ write: true });
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const parsed = parseMessageText(body.text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const attachmentIds = parseAttachmentIds(body.attachmentIds);
  if (!attachmentIds) return NextResponse.json({ error: 'Cinq captures au maximum.' }, { status: 400 });

  const { data, error } = await createServiceClient().rpc('support_post_message', {
    p_ticket_id: params.id,
    p_tenant_id: guard.tenant.id,
    p_actor_type: 'tenant',
    p_actor_admin_id: guard.adminId,
    p_actor_label: guard.label,
    p_kind: 'message',
    p_body: parsed.text,
    p_client_key: parseClientKey(body.clientKey),
    p_attachment_ids: attachmentIds,
  });
  if (error) return supportErrorResponse(error, 'Message non envoyé. Votre texte est conservé : réessayez.');
  const row = (data as Array<{ out_message_id: string; out_created: boolean; out_reopened: boolean }> | null)?.[0];
  if (row?.out_created) await notifyPlatform(params.id, row.out_reopened ? 'reopened' : 'tenant_message');
  const thread = await tenantThread(guard.tenant.id, params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ messageId: row?.out_message_id ?? null, thread }, { status: row?.out_created ? 201 : 200 });
}
