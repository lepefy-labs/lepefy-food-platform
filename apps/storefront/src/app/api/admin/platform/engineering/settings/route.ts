import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { requireEngineeringApi } from '@/lib/engineering/server/guard';
import { ENGINEERING_REPOSITORY } from '@/lib/engineering/server/activeRun';
import { loadSettings } from '@/lib/engineering/server/metrics';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => createServiceClient() as any;

async function repositoryId(): Promise<string | null> {
  const { data } = await db().from('engineering_repositories').select('id').eq('slug', ENGINEERING_REPOSITORY).maybeSingle();
  return data?.id ?? null;
}

export async function GET() {
  const denied = await requireEngineeringApi('engineering.manage');
  if (denied) return denied;
  const id = await repositoryId();
  const settings = id ? await loadSettings(id) : null;
  if (!settings) return NextResponse.json({ error: 'Settings unavailable (migration 176?)' }, { status: 503, headers: NO_STORE });
  const { data: policy } = await db().from('ai_routing_policies').select('enabled').eq('consumer', 'engineering').eq('capability', 'structured_chat').maybeSingle();
  return NextResponse.json({ settings, routingPolicyEnabled: policy?.enabled === true }, { headers: NO_STORE });
}

/**
 * PATCH { aiEnabled?, dailyBudgetUsd?, perMinuteLimit?, maxToolCalls? }.
 * The routing policy itself ('engineering') is switched in /admin/platform/ai-routing, never here:
 * enabling the assistant needs BOTH switches, so a single click cannot start spending.
 */
export async function PATCH(request: Request) {
  const denied = await requireEngineeringApi('engineering.manage');
  if (denied) return denied;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: NO_STORE }); }

  const patch: Record<string, unknown> = {};
  if (typeof body.aiEnabled === 'boolean') patch.ai_enabled = body.aiEnabled;
  if (typeof body.dailyBudgetUsd === 'number' && body.dailyBudgetUsd >= 0 && body.dailyBudgetUsd <= 1000) patch.daily_budget_usd = Math.round(body.dailyBudgetUsd * 100) / 100;
  if (Number.isInteger(body.perMinuteLimit) && (body.perMinuteLimit as number) >= 1 && (body.perMinuteLimit as number) <= 600) patch.per_minute_limit = body.perMinuteLimit;
  if (Number.isInteger(body.maxToolCalls) && (body.maxToolCalls as number) >= 1 && (body.maxToolCalls as number) <= 12) patch.max_tool_calls = body.maxToolCalls;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400, headers: NO_STORE });

  const id = await repositoryId();
  if (!id) return NextResponse.json({ error: 'Repository unavailable' }, { status: 503, headers: NO_STORE });
  const { error } = await db().from('engineering_settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('repository_id', id);
  if (error) return NextResponse.json({ error: 'Update failed' }, { status: 500, headers: NO_STORE });
  return NextResponse.json({ settings: await loadSettings(id) }, { headers: NO_STORE });
}
