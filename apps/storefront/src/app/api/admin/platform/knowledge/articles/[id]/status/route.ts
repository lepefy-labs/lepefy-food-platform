import { NextRequest, NextResponse } from 'next/server';
import { HELP_STATUSES, type HelpStatus } from '@/lib/helpCenter/domain';
import { helpPlatformApi, readJsonBody } from '@/lib/helpCenter/server/access';
import { helpErrorMessage, setArticleStatus } from '@/lib/helpCenter/server/platformService';
import { canTransition } from '@/lib/helpCenter/rules';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStatus = (value: unknown): value is HelpStatus => typeof value === 'string' && (HELP_STATUSES as readonly string[]).includes(value);

/**
 * POST …/[id]/status { to, expected, note? } — editorial workflow
 * draft → review → published → archived. Publishing is an explicit action of
 * the platform owner and creates an immutable revision; nothing is ever
 * published automatically (AI-written drafts included).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await helpPlatformApi();
  if (!guard.ok) return guard.response;
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  const body = await readJsonBody(request, 4_000);
  if (!body || !isStatus(body.to) || !isStatus(body.expected)) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 });
  if (!canTransition(body.expected, body.to)) return NextResponse.json({ error: 'Ce changement de statut n’est pas autorisé.' }, { status: 409 });
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) || null : null;
  try {
    const result = await setArticleStatus(params.id, body.to, body.expected, guard.adminId, note);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: helpErrorMessage(error) }, { status: 409 });
  }
}
