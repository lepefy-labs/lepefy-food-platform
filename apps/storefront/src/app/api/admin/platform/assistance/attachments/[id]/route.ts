import { createServiceClient } from '@/lib/supabase/server';
import { supportPlatformApi } from '@/lib/support/server/access';
import { attachmentRedirect, deleteStagedAttachment } from '@/lib/support/server/attachments';
import { NextResponse } from 'next/server';
import { isUuid } from '@/lib/support/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  return attachmentRedirect(params.id, { kind: 'lepefy', adminId: guard.adminId });
}

/** Removes a screenshot Lepefy added but did not send. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
  const { data } = await createServiceClient().from('support_attachments').select('tenant_id').eq('id', params.id).maybeSingle();
  const tenantId = (data as { tenant_id: string } | null)?.tenant_id;
  if (!tenantId) return NextResponse.json({ error: 'Image introuvable.' }, { status: 404 });
  return deleteStagedAttachment(tenantId, guard.adminId, params.id);
}
