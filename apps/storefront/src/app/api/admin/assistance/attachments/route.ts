import { NextResponse } from 'next/server';
import { SUPPORT_LIMITS } from '@/lib/support/domain';
import { supportTenantApi } from '@/lib/support/server/access';
import { uploadSupportAttachment } from '@/lib/support/server/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Screenshot added before sending (private storage, real type checked on the bytes). */
export async function POST(request: Request) {
  const guard = await supportTenantApi({ write: true });
  if (!guard.ok) return guard.response;
  if (Number(request.headers.get('content-length') ?? '0') > SUPPORT_LIMITS.attachmentBytes + 64_000) {
    return NextResponse.json({ error: 'Image trop lourde : 5 Mo au maximum.' }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'Aucune image reçue.' }, { status: 400 });
  return uploadSupportAttachment({ tenantId: guard.tenant.id, adminId: guard.adminId, uploaderType: 'tenant', file: form.get('file') });
}
