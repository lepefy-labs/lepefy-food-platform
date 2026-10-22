import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid, parseGithubLink } from '@/lib/support/rules';
import { readJsonBody, supportPlatformApi } from '@/lib/support/server/access';
import { platformTicketDetail } from '@/lib/support/server/platformService';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GitHub issue, PR, commit or release linked to a request. Stored as a
 * verified URL only (no token, no API call); never shown to the shop and never
 * closing the request on its own.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await readJsonBody(request, 2_000);
  const link = parseGithubLink(body?.url);
  if (!link) return NextResponse.json({ error: 'Collez l’adresse d’une issue, pull request, commit ou release GitHub.' }, { status: 400 });
  const label = typeof body?.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 140) : link.label;
  const { error } = await createServiceClient().rpc('support_add_link', {
    p_ticket_id: params.id, p_actor_admin_id: guard.adminId, p_kind: link.kind, p_url: link.url, p_label: label,
  });
  if (error) return supportErrorResponse(error);
  const detail = await platformTicketDetail(params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ detail });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  const linkId = new URL(request.url).searchParams.get('linkId');
  if (!isUuid(params.id) || !isUuid(linkId)) return NextResponse.json({ error: 'Lien introuvable.' }, { status: 404 });
  const { error } = await createServiceClient().rpc('support_remove_link', { p_ticket_id: params.id, p_link_id: linkId, p_actor_admin_id: guard.adminId });
  if (error) return supportErrorResponse(error);
  const detail = await platformTicketDetail(params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ detail });
}
