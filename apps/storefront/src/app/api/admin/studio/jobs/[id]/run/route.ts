import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { studioApi } from '@/lib/studio/server/access';
import { processStudioJobs } from '@/lib/studio/server/worker';
import { isUuid } from '@/lib/studio/rules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST — starts the job right away (the page sends it with `keepalive`, then
 * may close: the function keeps running). Safe to call twice and safe with
 * the n8n tick: the job is claimed by compare-and-set; a second caller gets
 * nothing to do. The page never waits on this response for its state.
 */
export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const guard = await studioApi();
  if (!guard.ok) return guard.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  const { data } = await createServiceClient().from('studio_jobs').select('id')
    .eq('tenant_id', guard.tenant.id).eq('id', params.id).maybeSingle();
  if (!data) return NextResponse.json({ error: 'Introuvable.' }, { status: 404 });
  const result = await processStudioJobs({ jobId: params.id, deadlineMs: 110_000 });
  return NextResponse.json({ processed: result.processed, result: result.results[0] ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
