import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { parisDayStartIso } from '../dates';
import type { GrowthProspectRow, GrowthTouchRow } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const db = (): Db => createServiceClient();

/** Missing migration 185: the page says so instead of failing. */
export class GrowthUnavailableError extends Error {}

function check<T>(res: { data: T | null; error: { code?: string; message?: string } | null }): T {
  if (res.error) throw new GrowthUnavailableError(res.error.code ?? 'growth_unavailable');
  return res.data as T;
}

export async function listGrowthProspects(): Promise<GrowthProspectRow[]> {
  return check(await db().from('growth_prospects').select('*').order('fit_score', { ascending: false }).limit(1000)) ?? [];
}

export async function getGrowthProspect(id: string): Promise<GrowthProspectRow | null> {
  return check(await db().from('growth_prospects').select('*').eq('id', id).maybeSingle());
}

export async function listTouches(prospectId: string): Promise<GrowthTouchRow[]> {
  return check(await db().from('growth_prospect_touches').select('id, prospect_id, occurred_at, channel, outcome, reason, note, message_text')
    .eq('prospect_id', prospectId).order('occurred_at', { ascending: false }).limit(200)) ?? [];
}

/** Number of contacts per shop (worklist badges). */
export async function touchCounts(): Promise<Record<string, number>> {
  const rows: { prospect_id: string }[] = check(await db().from('growth_prospect_touches').select('prospect_id').limit(5000)) ?? [];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.prospect_id] = (out[r.prospect_id] ?? 0) + 1;
  return out;
}

export async function whatsappSentToday(now: Date = new Date()): Promise<number> {
  const res = await db().from('growth_prospect_touches').select('id', { count: 'exact', head: true })
    .eq('channel', 'whatsapp').gte('occurred_at', parisDayStartIso(now));
  if (res.error) throw new GrowthUnavailableError(res.error.code ?? 'growth_unavailable');
  return res.count ?? 0;
}

export { db as growthDb };
