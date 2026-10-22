import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { SUPPORT_LIMITS } from '@/lib/support/domain';
import { isUuid } from '@/lib/support/rules';
import { supportPlatformApi } from '@/lib/support/server/access';
import { uploadSupportAttachment } from '@/lib/support/server/attachments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Screenshot attached by Lepefy (reply, note or manual request) in the shop's private folder. */
export async function POST(request: Request) {
  const guard = await supportPlatformApi();
  if (!guard.ok) return guard.response;
  if (Number(request.headers.get('content-length') ?? '0') > SUPPORT_LIMITS.attachmentBytes + 64_000) {
    return NextResponse.json({ error: 'Image trop lourde : 5 Mo au maximum.' }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const tenantId = form?.get('tenantId');
  if (!form || !isUuid(tenantId)) return NextResponse.json({ error: 'Boutique manquante.' }, { status: 400 });
  const { data: tenant } = await createServiceClient().from('tenants').select('id').eq('id', tenantId).maybeSingle();
  if (!tenant) return NextResponse.json({ error: 'Boutique introuvable.' }, { status: 404 });
  return uploadSupportAttachment({ tenantId, adminId: guard.adminId, uploaderType: 'lepefy', file: form.get('file') });
}
