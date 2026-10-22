import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/support/rules';
import { supportTenantApi } from '@/lib/support/server/access';
import { supportErrorResponse } from '@/lib/support/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The admin opened the conversation: its Lepefy updates are read (per admin). */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportTenantApi({ write: false });
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Demande introuvable.' }, { status: 404 });
  // A Lepefy account previewing the shop view never marks the shop's messages as read.
  if (guard.isPlatformOwner) return NextResponse.json({ ok: true });
  const { error } = await createServiceClient().rpc('support_mark_read', {
    p_ticket_id: params.id, p_tenant_id: guard.tenant.id, p_admin_id: guard.adminId, p_side: 'tenant',
  });
  if (error) return supportErrorResponse(error);
  return NextResponse.json({ ok: true });
}
