import { NextResponse } from 'next/server';
import { requireEngineeringApi } from '@/lib/engineering/server/guard';
import { askEngineering } from '@/lib/engineering/server/askService';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST { question, history? } — Platform Owner only. Every response is no-store. */
export async function POST(request: Request) {
  const denied = await requireEngineeringApi('engineering.ai.use');
  if (denied) return denied;

  let body: { question?: unknown; history?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
  if (typeof body.question !== 'string' || body.question.trim().length < 3) {
    return NextResponse.json({ error: 'Question required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const result = await askEngineering({ question: body.question, history: body.history, actor: { kind: 'owner', clientId: null } });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
