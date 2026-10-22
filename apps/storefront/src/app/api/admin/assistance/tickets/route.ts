import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isSupportCategory } from '@/lib/support/domain';
import { buildSupportContext, deriveTitle, resourceFromPath, sanitizeAdminPathname } from '@/lib/support/rules';
import { readJsonBody, supportTenantApi } from '@/lib/support/server/access';
import { appVersion, parseAttachmentIds, parseClientKey, parseMessageText } from '@/lib/support/server/input';
import { verifySupportResource } from '@/lib/support/server/tenantService';
import { notifyPlatform } from '@/lib/support/server/notify';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * New request from the shop. Only the text is required; the page, device,
 * language and build are added here from verified data (the browser sends a
 * pathname and a language, never a tenant, a title or an internal field).
 */
export async function POST(request: Request) {
  const guard = await supportTenantApi({ write: true });
  if (!guard.ok) return guard.response;
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });

  const parsed = parseMessageText(body.text);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const attachmentIds = parseAttachmentIds(body.attachmentIds);
  if (!attachmentIds) return NextResponse.json({ error: 'Cinq captures au maximum.' }, { status: 400 });
  const category = isSupportCategory(body.category) ? body.category : 'unspecified';

  // Page concernée: kept unless the admin removed it; a label chosen by the admin replaces the derived one.
  const pathname = body.includePage === false ? null : sanitizeAdminPathname(body.pathname);
  const chosenLabel = typeof body.pageLabel === 'string' ? body.pageLabel.replace(/[^\p{L}\p{N} ’'&·()-]/gu, '').trim().slice(0, 60) : '';
  const context = buildSupportContext({
    pathname,
    pageLabel: chosenLabel || null,
    locale: body.locale,
    userAgent: headers().get('user-agent'),
    appVersion: appVersion(),
    viewport: body.viewport,
  });
  if (!pathname && chosenLabel) context.page_label = chosenLabel;
  const resource = pathname
    ? await verifySupportResource(guard.tenant.id, guard.access, resourceFromPath(pathname), createServiceClient())
    : null;

  const { data, error } = await createServiceClient().rpc('support_create_ticket', {
    p_tenant_id: guard.tenant.id,
    p_actor_type: 'tenant',
    p_actor_admin_id: guard.adminId,
    p_actor_label: guard.label,
    p_title: deriveTitle(parsed.text),
    p_body: parsed.text,
    p_category: category,
    p_declared_urgent: body.urgent === true,
    p_context: context,
    p_resource_type: resource?.type ?? null,
    p_resource_id: resource?.id ?? null,
    p_resource_label: resource?.label ?? null,
    p_client_key: parseClientKey(body.clientKey),
    p_attachment_ids: attachmentIds,
  });
  if (error) return supportErrorResponse(error, 'Votre demande n’a pas pu être envoyée. Votre texte est conservé : réessayez.');
  const row = (data as Array<{ out_ticket_id: string; out_number: number; out_created: boolean }> | null)?.[0];
  if (!row) return NextResponse.json({ error: 'Votre demande n’a pas pu être envoyée. Réessayez.' }, { status: 500 });
  if (row.out_created) await notifyPlatform(row.out_ticket_id, 'created');
  return NextResponse.json({ ticket: { id: row.out_ticket_id, number: row.out_number }, created: row.out_created }, { status: row.out_created ? 201 : 200 });
}
