import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isSupportCategory, isSupportPriority, isSupportStatus } from '@/lib/support/domain';
import { isUuid } from '@/lib/support/rules';
import { readJsonBody, supportPlatformApi } from '@/lib/support/server/access';
import { platformTicketDetail } from '@/lib/support/server/platformService';
import { notifyTenantOfUpdate } from '@/lib/support/server/notify';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  try {
    const detail = await platformTicketDetail(params.id, guard.adminId);
    if (!detail) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
    return NextResponse.json({ detail }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return supportErrorResponse(error, 'Demande indisponible pour le moment.');
  }
}

/**
 * Status (validated transition, optional expected status against concurrent
 * edits), priority, assignee, category, title, visibility — each through the
 * 163 RPCs, never a direct update.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await readJsonBody(request, 4_000);
  if (!body) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const db = createServiceClient();

  if (body.status !== undefined) {
    if (!isSupportStatus(body.status)) return NextResponse.json({ error: 'Statut inconnu.' }, { status: 400 });
    const { data, error } = await db.rpc('support_set_status', {
      p_ticket_id: params.id, p_actor_admin_id: guard.adminId, p_to_status: body.status,
      p_expected_status: isSupportStatus(body.expectedStatus) ? body.expectedStatus : null,
    });
    if (error) return supportErrorResponse(error);
    const changed = (data as Array<{ out_changed: boolean }> | null)?.[0]?.out_changed;
    if (changed && body.status === 'resolved') await notifyTenantOfUpdate(params.id, 'resolved');
    if (changed && body.status === 'waiting_tenant') await notifyTenantOfUpdate(params.id, 'waiting');
  }

  const assignee = body.assignee === 'none' ? null : isUuid(body.assignee) ? body.assignee : undefined;
  if (body.priority !== undefined && !isSupportPriority(body.priority)) return NextResponse.json({ error: 'Priorité inconnue.' }, { status: 400 });
  if (body.category !== undefined && !isSupportCategory(body.category)) return NextResponse.json({ error: 'Catégorie inconnue.' }, { status: 400 });
  if (body.assignee !== undefined && assignee === undefined) return NextResponse.json({ error: 'Personne inconnue.' }, { status: 400 });
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 140) : null;
  if (body.title !== undefined && !title) return NextResponse.json({ error: 'Le titre ne peut pas être vide.' }, { status: 400 });
  if (body.priority !== undefined || body.category !== undefined || assignee !== undefined || title || typeof body.visible === 'boolean') {
    const { error } = await db.rpc('support_update_ticket', {
      p_ticket_id: params.id,
      p_actor_admin_id: guard.adminId,
      p_priority: (body.priority as string | undefined) ?? null,
      p_assignee: assignee ?? null,
      p_clear_assignee: body.assignee === 'none',
      p_category: (body.category as string | undefined) ?? null,
      p_title: title,
      p_visible: typeof body.visible === 'boolean' ? body.visible : null,
    });
    if (error) return supportErrorResponse(error);
  }

  const detail = await platformTicketDetail(params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ detail });
}
