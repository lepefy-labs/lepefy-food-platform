import { NextResponse } from 'next/server';
import { authenticateMachine } from '@/lib/engineering/server/machineAuth';
import { askEngineering } from '@/lib/engineering/server/askService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Machine API: POST { question } (scope `ask`). Same admission rules as the chat: off switch, rate limit, daily budget. */
export async function POST(request: Request) {
  const auth = await authenticateMachine(request, 'ask');
  if ('response' in auth) return auth.response;

  let body: { question?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }); }
  if (typeof body.question !== 'string' || body.question.trim().length < 3) return NextResponse.json({ error: 'Question required' }, { status: 400, headers: NO_STORE });

  const result = await askEngineering({ question: body.question, actor: { kind: 'machine', clientId: auth.client.clientId } });
  const status = result.state === 'rate_limited' ? 429 : result.state === 'disabled' || result.state === 'budget_exceeded' ? 503 : 200;
  return NextResponse.json(result, { status, headers: NO_STORE });
}
