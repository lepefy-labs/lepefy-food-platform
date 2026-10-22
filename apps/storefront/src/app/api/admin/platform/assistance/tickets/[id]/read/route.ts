import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/support/rules';
import { supportPlatformApi } from '@/lib/support/server/access';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The platform owner opened the request: the shop's messages are read for this person. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  const { error } = await createServiceClient().rpc('support_mark_read', {
    p_ticket_id: params.id, p_tenant_id: null, p_admin_id: guard.adminId, p_side: 'lepefy',
  });
  if (error) return supportErrorResponse(error);
  return NextResponse.json({ ok: true });
}
