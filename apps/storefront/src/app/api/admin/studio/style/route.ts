import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { recordAuditEvent } from '@/lib/audit/recordAuditEvent';
import { readJson, studioApi, studioErrorResponse } from '@/lib/studio/server/access';
import { ensureActiveStyle, styleHistory } from '@/lib/studio/server/style';
import { cleanText } from '@/lib/studio/rules';
import { studioStyleSchema } from '@/lib/studio/style';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — active style and history (read-only for the shop). */
export async function GET() {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  try {
    const db = createServiceClient();
    const active = await ensureActiveStyle(db, guard.tenant.id, guard.adminId);
    return NextResponse.json({ active, history: await styleHistory(db, guard.tenant.id), canEdit: guard.access.isPlatformOwner });
  } catch (error) {
    return studioErrorResponse(error);
  }
}

/**
 * POST — publishes a new style version (platform owner only: the pattern is
 * set by Lepefy with the shop). Rows are immutable; `expectedVersion`
 * refuses a concurrent edit. Proposals already made keep their version.
 */
export async function POST(request: NextRequest) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  if (!guard.access.isPlatformOwner) return NextResponse.json({ error: 'Réservé à Lepefy.' }, { status: 403 });
  const body = await readJson(request, 32_000);
  const parsed = studioStyleSchema.safeParse(body?.instructions);
  const expected = Number(body?.expectedVersion);
  if (!parsed.success || !Number.isInteger(expected)) return NextResponse.json({ error: 'Style incomplet : remplissez chaque champ.' }, { status: 400 });
  try {
    const { data, error } = await createServiceClient().rpc('studio_publish_style', {
      p_tenant_id: guard.tenant.id, p_instructions: parsed.data, p_note: cleanText(body?.note, 500),
      p_admin_id: guard.adminId, p_expected_version: expected,
    });
    if (error) throw error;
    const row = ((data ?? []) as Array<{ out_id: string; out_version: number }>)[0];
    await recordAuditEvent({
      tenantId: guard.tenant.id, eventType: 'studio.style.published', actor: guard.access, resourceType: 'studio_style',
      resourceId: row?.out_id, resourceLabel: 'Style v' + row?.out_version, metadata: { version: row?.out_version },
    });
    return NextResponse.json({ id: row?.out_id, version: row?.out_version }, { status: 201 });
  } catch (error) {
    return studioErrorResponse(error);
  }
}
