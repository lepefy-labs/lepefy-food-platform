import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/support/rules';
import { readJsonBody, supportPlatformApi } from '@/lib/support/server/access';
import { platformTicketDetail } from '@/lib/support/server/platformService';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Duplicate: this request is closed and points to the target (same shop only), both histories keep the trace. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const body = await readJsonBody(request, 1_000);
  const target = String(body?.targetNumber ?? '').replace(/^#|^n°\s*/i, '').trim();
  if (!/^\d{1,12}$/.test(target)) return NextResponse.json({ error: 'Indiquez le numéro de la demande à conserver.' }, { status: 400 });
  const { error } = await createServiceClient().rpc('support_merge_ticket', {
    p_source_id: params.id, p_target_number: Number(target), p_actor_admin_id: guard.adminId,
  });
  if (error) return supportErrorResponse(error);
  const detail = await platformTicketDetail(params.id, guard.adminId).catch(() => null);
  return NextResponse.json({ detail });
}
