import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/support/rules';
import { readJsonBody, supportTenantApi } from '@/lib/support/server/access';
import { tenantThread } from '@/lib/support/server/tenantService';
import { notifyPlatform } from '@/lib/support/server/notify';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** « Est-ce que le problème est résolu ? » — Oui closes, Non reopens (SQL support_record_feedback). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportTenantApi({ write: true });
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await readJsonBody(request, 1_000);
  if (!body || typeof body.solved !== 'boolean') return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  const { data, error } = await createServiceClient().rpc('support_record_feedback', {
    p_ticket_id: params.id, p_tenant_id: guard.tenant.id, p_actor_admin_id: guard.adminId, p_solved: body.solved,
  });
  if (error) return supportErrorResponse(error);
  const row = (data as Array<{ out_changed: boolean }> | null)?.[0];
  if (row?.out_changed && !body.solved) await notifyPlatform(params.id, 'reopened');
  const thread = await tenantThread(guard.tenant.id, params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ thread });
}
