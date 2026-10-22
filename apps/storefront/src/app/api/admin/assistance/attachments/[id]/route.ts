import { supportTenantApi } from '@/lib/support/server/access';
import { attachmentRedirect, deleteStagedAttachment } from '@/lib/support/server/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Image of the shop's own request (never an internal one): 60 s signed URL. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportTenantApi({ write: false });
  if (!guard.ok) return guard.response;
  return attachmentRedirect(params.id, { kind: 'tenant', tenantId: guard.tenant.id, adminId: guard.adminId });
}

/** Removes a screenshot before sending. */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const guard = await supportTenantApi({ write: true });
  if (!guard.ok) return guard.response;
  return deleteStagedAttachment(guard.tenant.id, guard.adminId, params.id);
}
