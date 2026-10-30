import { NextRequest, NextResponse } from 'next/server';
import { helpPlatformApi, readJsonBody } from '@/lib/helpCenter/server/access';
import { helpErrorMessage, restoreRevision } from '@/lib/helpCenter/server/platformService';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST …/[id]/restore { version } — copies a past revision into the working copy. It does not publish. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await helpPlatformApi();
  if (!guard.ok) return guard.response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  const body = await readJsonBody(request, 1_000);
  const version = Number(body?.version);
  if (!Number.isInteger(version) || version < 1) return NextResponse.json({ error: 'Révision invalide.' }, { status: 400 });
  try {
    await restoreRevision(params.id, version, guard.adminId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: helpErrorMessage(error) }, { status: 409 });
  }
}
